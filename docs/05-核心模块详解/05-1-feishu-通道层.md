# 05-1 feishu 通道层

> 对应源码：`src/feishu/channel.ts`、`src/feishu/context.ts`、`src/feishu/webhook.ts`

## 1. 通道层的作用

通道层是**飞书世界的入口和出口**，职责单一：

- 入口：接收消息、卡片动作、错误
- 出口：发送文本/markdown/卡片/文件/图片，更新卡片，下载附件

它是一层「皮」——内部用飞书 SDK，对外暴露的是本项目自己的类型，**调用方永远看不到飞书 SDK 的原始结构**。

## 2. createFeishuChannel：SDK 封装

### 2.1 创建底层通道

```ts
const raw = createLarkChannel({
  appId: options.appId,
  appSecret: options.appSecret,
  loggerLevel,
  policy: { requireMention: options.requireMention, dmMode: "open" },
  includeRawEvent: true,                        // 带上原始事件（方便归一化时兜底）
  safety: { chatQueue: { enabled: false } },    // ★ 关闭 SDK 内部 chat 队列
}) as unknown as RawLarkChannel;
```

**为什么关闭 SDK 的 chatQueue？**

飞书 SDK 内部默认对同一个 chat 的消息串行处理（防止并发发消息）。
但本项目自己实现了**每会话队列**（`PromptQueue`），且需要「卡片动作」和「消息」并行处理。
如果开着 SDK 的 queue，权限确认卡片可能被消息阻塞，导致确认迟迟无法响应。
所以关掉它，用自己的队列——这是架构设计文档里明确写过的坑。

### 2.2 归一化：把 SDK 的怪类型翻译成自己的类型

飞书 SDK 事件字段名混乱（既有 `message_id` 又有 `messageId`，既有 snake_case 又有 camelCase），
所以 `channel.ts` 里有一堆 `readString` / `normalizeMessage` / `normalizeCardAction`。

```ts
function normalizeMessage(value: unknown): FeishuMessage {
  const record = asRecord(value);
  // 兼容两种命名：rawContentType / messageType、chat_id / chatId ...
  return {
    messageId: readString(record, "messageId") ?? readString(record, "message_id") ?? "",
    chatType: chatTypeText === "p2p" || chatTypeText === "private" ? "private" : "group",
    ...
  };
}
```

这是一个教学要点：**对接外部 SDK 时，先做一次「归一化」，把外部世界的混乱挡在边界外**。
下游所有模块只依赖 `FeishuMessage` 这一种干净的类型。

### 2.3 发送方法

```ts
async sendText(chatId, text, replyOptions) {
  return normalizeSendResult(await raw.send(chatId, { text }, replyOptions));
}
async sendMarkdown(chatId, markdown, replyOptions) {
  return normalizeSendResult(await raw.send(chatId, { markdown }, replyOptions));
}
async sendCard(chatId, card, replyOptions) {
  return normalizeSendResult(await raw.send(chatId, { card }, replyOptions));
}
```

三个方法都调用同一个 `raw.send`，只是 content 类型不同。飞书 SDK 根据内容结构区分文本/markdown/卡片。

### 2.4 流式输出

```ts
async streamMarkdown(chatId, producer, replyOptions) {
  await raw.stream(chatId, { markdown: producer }, replyOptions);
}
```

这是飞书 SDK 提供的**流式能力**：`producer` 是一个回调，SDK 反复调用它拿增量内容，实时更新消息。
`stream-renderer` 就是往里喂增量的生产者（见 `05-6`）。

### 2.5 更新卡片：两种方式

```ts
async updateCard(messageId, card) {
  await raw.updateCard(messageId, card);
}
async updateCardByToken(token, card) {
  await raw.rawClient.request({
    url: "/open-apis/interactive/v1/card/update",
    method: "POST",
    data: { token, card },
  });
}
```

- 消息 ID 方式：在自己发的卡片上用（任务状态卡）
- Token 方式：**卡片回调事件自带 token**，适合「按钮点击后原地更新这张卡」（比如权限确认的「已选择 Yes」）

### 2.6 文件与附件

```ts
async sendFile(chatId, filePath, fileName) {
  const statResult = await stat(filePath);
  if (!statResult.isFile()) throw new Error("Path is not a file");
  await raw.send(chatId, { file: { source: filePath, fileName: fileName ?? basename(filePath) } });
}

async downloadResource(messageId, fileKey, type) {
  const response = await raw.rawClient.im.v1.messageResource.get({
    path: { message_id: messageId, file_key: fileKey },
    params: { type },
  });
  // 把可读流全部读成 Buffer 返回
  const chunks: Buffer[] = [];
  for await (const chunk of response.getReadableStream()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
```

- 发送前校验「路径必须是文件」，把错误挡在 SDK 调用之前
- 下载资源返回 `Buffer`，交给附件处理器统一处理

## 3. context.ts：飞书运行上下文

已在 `03-核心概念.md` 详细讲过（AsyncLocalStorage），这里只补充它在层中的位置：
它是 bridge 层与 tools 层之间的「暗通道」——**不通过函数参数传值，通过异步上下文传值**。

## 4. webhook.ts：占位实现

```ts
export function createWebhookNotImplementedError(): Error {
  return new Error("Feishu webhook transport is not implemented yet; use websocket transport.");
}
```

整个文件只有这一个函数。设计文档规划了 webhook 能力（验签、解密、URL challenge），
但 MVP 用 WebSocket 就够了。`bin/pi-remote-feishu.ts` 里检测到 webhook 配置直接抛这个错。

**教学点：占位比空壳好。** 用一个语义明确的错误函数占位，让未来的实现者知道「这里要做什么、为什么还没做」，比注释强。

## 5. 为什么 channel 用工厂函数而不是类

```ts
export function createFeishuChannel(options: CreateFeishuChannelOptions): FeishuChannel { ... }
```

- 返回**接口类型** `FeishuChannel`，调用方只见接口
- 内部用闭包持有 `raw`、`connected`，比类的 `private` 更彻底（外部完全无法触碰）
- 测试时可以传入任何满足接口的 mock（见 `test/send-file-to-chat.test.ts`）

## 6. 小结

| 子模块 | 职责 | 教学要点 |
|---|---|---|
| channel.ts | SDK 封装 + 类型归一化 | 外部世界混乱 → 边界处翻译成干净类型 |
| context.ts | 运行上下文 | AsyncLocalStorage 暗通道 |
| webhook.ts | 占位 | 语义化占位 > 空壳 |

下一步：`05-2-配置系统.md`
