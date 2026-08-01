# Pi 飞书扩展架构设计

## 目标

设计一个面向 Pi Agent 的飞书集成扩展包，让用户可以在飞书私聊和群聊里向 Pi Agent 发送消息，并把 Pi 的回复、卡片、权限确认、文件回传等能力投射回飞书。

这不是简单复制 `pi-remote-feishu-cli`。参考包证明了飞书消息、卡片、流式输出、附件和 `AgentSessionRuntime` 可以跑通，但目标架构应该更清晰地分离“飞书长连接进程”和“Pi 扩展注册能力”，这样后续能安装、部署、测试和演进。

MVP 聚焦一个飞书应用服务一个团队内的私聊和群聊。完整多租户不是 MVP 目标。可以在数据结构中保留 `tenantKey` 字段，方便未来扩展，但第一版不要为多企业共享服务支付复杂度。

## 核心判断

Pi 的 `AgentSessionRuntime` 是单 active session 模型：

```text
AgentSessionRuntime
  -> runtime.session
  -> runtime.switchSession()
  -> runtime.newSession()
```

这适合终端 TUI，因为终端天然只有一个当前会话。但飞书是多用户、多群、多消息入口。如果所有飞书消息共用一个 `runtime.session`，会出现：

- A 用户消息进入 B 用户上下文。
- A 正在生成时，B 的消息触发 session 切换。
- B 点击 stop 误中断 A 的任务。
- 权限确认卡片串线。
- 流式输出发错群或发错私聊。

因此架构里要引入：

```text
ConversationRouter
  -> SessionHostManager
  -> Map<sessionKey, SessionHost>
```

每个 `SessionHost` 拥有自己的 runtime、queue、active run 和飞书上下文。

## 设计原则

1. 不改 Pi core。
   飞书应该作为外部 transport 接入，尽量不侵入 `pi-main`。

2. 把飞书作为正式 transport。
   不要把它做成“终端外挂”。它需要独立的消息归一化、会话映射、权限策略、UI 桥接和渲染层。

3. 分离 transport host 和 Pi extension。
   接收飞书消息需要一个长期运行的进程；注册工具、命令和 prompt guidance 属于 Pi extension。

4. 私聊和群聊分开建模。
   私聊默认按用户隔离；群聊默认一个群共享一个会话，并要求 @bot 才响应。

5. 不提前做复杂多租户。
   保留 `tenantKey` 字段，但 MVP 不做 tenant router、tenant policy、tenant billing 这类设计。

6. 每个会话独立并发。
   同一个私聊或群聊内部串行，不同私聊和群聊可以并行。

## 推荐包结构

```text
pi-remote-feishu/
  package.json
  README.md
  ARCHITECTURE.md
  ARCHITECTURE.zh-CN.md
  src/
    bin/
      pi-remote-feishu.ts
    config/
      load-config.ts
      schema.ts
    feishu/
      channel.ts
      webhook.ts
      verifier.ts
      types.ts
    bridge/
      runtime-host.ts
      conversation-router.ts
      session-host-manager.ts
      message-normalizer.ts
      message-handler.ts
      stream-renderer.ts
      ui-context.ts
      card-actions.ts
      prompt-queue.ts
    cards/
      help.ts
      models.ts
      sessions.ts
      stop.ts
      permission.ts
      result.ts
    attachments/
      processor.ts
      mime.ts
      temp-files.ts
    store/
      store.ts
      json-store.ts
      sqlite-store.ts
    tools/
      send-file-to-chat.ts
    extensions/
      index.ts
    test/
      suite/
```

`package.json` 同时暴露 CLI 和 Pi package 资源：

```json
{
  "name": "pi-remote-feishu",
  "type": "module",
  "bin": {
    "pi-remote-feishu": "./dist/bin/pi-remote-feishu.js"
  },
  "pi": {
    "extensions": [
      "./dist/extensions/index.js"
    ]
  }
}
```

`bin` 用来启动飞书服务进程；`pi.extensions` 让 Pi 的包管理器发现并加载扩展。

## 总体架构

```text
Feishu 用户
  -> 飞书 WebSocket 或 Webhook
  -> 事件校验
  -> 消息归一化
  -> 权限和路由
  -> ConversationRouter
  -> SessionHostManager
  -> SessionHost
  -> per-session PromptQueue
  -> per-session AgentSessionRuntime
  -> StreamRenderer
  -> 飞书文本/卡片/文件响应

Pi extension system
  -> extensions/index.ts
  -> 注册 send_file_to_chat
  -> 注册 /feishu 命令
  -> 把 ExtensionUIContext 桥接到飞书卡片
```

关键拆分：

```text
Transport Host
  长期运行的进程，负责连接飞书、接收消息、分发事件。

Pi Extension
  被 Pi 加载，负责注册工具、命令、prompt guidance 和 UI 能力。
```

## 私聊和群聊会话模型

推荐 MVP key：

```text
私聊:
  dm:{userOpenId}

群聊共享会话:
  group:{chatId}

群聊按用户隔离，可选:
  group-user:{chatId}:{userOpenId}
```

默认策略：

```ts
interface FeishuConversationPolicy {
  privateScope: "per-user";
  groupScope: "shared-chat";
  requireMentionInGroup: true;
}
```

行为：

- 私聊：每个用户一个 Pi session。
- 群聊：每个群一个共享 Pi session。
- 群聊必须 @bot 才响应。
- 群聊 prompt 里带发送者信息。
- 未来可以让指定群开启 `group-user` 模式。

群聊 prompt 示例：

```text
[Feishu group message]
Sender: 张三
Message:
帮我看一下这个报错
```

这样 Pi 能知道群里是谁在说话。

## SessionHost 设计

不要让所有用户共用一个 runtime。推荐：

```ts
interface SessionHost {
  sessionKey: string;
  runtime: AgentSessionRuntime;
  queue: PromptQueue;
  activeRun?: ActiveRun;
  lastUsedAt: Date;
}
```

运行时结构：

```text
FeishuBotHost
  -> ConversationRouter
  -> SessionHostManager
       -> dm:alice        -> SessionHost A -> Runtime A
       -> dm:bob          -> SessionHost B -> Runtime B
       -> group:chat-123  -> SessionHost C -> Runtime C
```

并发规则：

- 同一个 `sessionKey` 内部串行。
- 不同 `sessionKey` 可以并行。
- `/stop` 只中断当前 `sessionKey` 的 active run。
- 权限卡片只 resolve 当前 run 的 pending dialog。
- 流式输出只发送回当前 chat。

生命周期：

- 首次消息到达时创建 `SessionHost`。
- 活跃期间复用 runtime。
- 空闲超过 TTL 后释放 runtime。
- 释放前持久化 session file 映射。
- 下次消息到达时从 session file 恢复。

## 核心模块说明

### `feishu/channel.ts`

封装飞书 SDK。

职责：

- 创建飞书 WebSocket client。
- 接收消息和卡片 action。
- 发送文本、markdown、卡片、图片、文件。
- 通过 message id 或 token 更新卡片。
- 下载消息附件资源。
- 屏蔽 SDK 的原始类型细节。

### `feishu/webhook.ts`

Webhook transport。

职责：

- 启动 HTTP server。
- 处理飞书 URL challenge。
- 校验 timestamp、signature、verification token。
- 解密加密事件。
- 把 webhook payload 转成统一事件模型。

MVP 可以先不做 webhook，先做 WebSocket。

### `bridge/conversation-router.ts`

把飞书消息映射成 `sessionKey`。

职责：

- 判断私聊还是群聊。
- 群聊检查是否 @bot。
- 生成 `dm:*`、`group:*` 或 `group-user:*`。
- 提供可配置 group scope。
- 保留 `tenantKey` 作为未来扩展字段。

### `bridge/session-host-manager.ts`

管理所有活跃 `SessionHost`。

职责：

- 根据 `sessionKey` 查找或创建 host。
- 从 store 恢复 session file。
- 空闲回收 runtime。
- 管理 active run。
- 保证 stop、stream、permission、context 不串线。

### `bridge/runtime-host.ts`

管理单个 Pi runtime。

职责：

- 创建 `AgentSessionRuntime`。
- 打开指定 session file。
- 绑定 extensions。
- 暴露 `prompt()`、`abort()`、`setModel()`、`listSessions()` 等能力。
- 在一次飞书请求执行期间设置 Feishu context 和 Feishu UI context。

### `bridge/prompt-queue.ts`

每个 `SessionHost` 一个 queue。

职责：

- 同会话消息串行。
- 不同会话不互相阻塞。
- 保存当前 active run。
- 支持 abort。

不要使用全局锁。全局锁会导致一个群生成很久时，所有私聊和其他群都被阻塞。

### `bridge/message-normalizer.ts`

把飞书消息转换成 Pi 输入。

归一化后的结构：

```ts
interface NormalizedPiInput {
  sessionKey: string;
  chatId: string;
  messageId: string;
  userId: string;
  tenantKey?: string;
  chatType: "private" | "group";
  senderName?: string;
  text: string;
  images: Array<{ type: "image"; data: string; mimeType: string }>;
  attachmentNotes: string[];
  command?: FeishuCommand;
}
```

职责：

- 去掉群聊中的 bot mention。
- 识别 `/help`、`/sessions`、`/models`、`/stop`。
- 忽略不支持的消息类型。
- 保留 sender 信息。
- 合并附件文本。

### `bridge/stream-renderer.ts`

把 Pi 事件渲染到飞书。

职责：

- 流式输出 assistant 文本。
- 渲染 thinking。
- 渲染 tool start/update/end。
- 渲染 retry、compaction、error 状态。
- 完成后更新最终卡片。

策略：

- 文本 delta 流式展示。
- thinking 默认折叠或引用展示。
- tool 输出默认简短。
- 大输出可以转文件发送。

### `bridge/ui-context.ts`

把 Pi 的 `ExtensionUIContext` 映射到飞书卡片。

这是一处亮点，因为它让现有 Pi extension 的交互能力可以远程使用。

映射：

```text
ctx.ui.confirm()
  -> 飞书确认卡片
  -> 用户点击
  -> resolve Promise
  -> 工具继续执行或被拒绝

ctx.ui.select()
  -> 飞书选择卡片

ctx.ui.notify()
  -> 飞书文本或提示卡片
```

注意：

- 卡片 action 必须能在 prompt 等待期间被处理。
- 如果飞书 SDK 对同一个 chat 串行化 message 和 card action，要关闭 SDK 内部 chat queue，用自己的 per-session queue。

### `bridge/card-actions.ts`

处理飞书卡片按钮。

支持：

- `session`: 新建、切换、删除。
- `model`: 选择 provider、model、thinking level。
- `stop`: 中断当前 run。
- `permission`: resolve confirm/select。
- `help`: 卡片内导航。

卡片 action handler 应该快速返回，耗时操作放到异步任务里。

### `tools/send-file-to-chat.ts`

注册 Pi 工具，让模型把生成的文件发回当前飞书聊天。

行为：

- 参数：`filePath`、可选 `fileName`。
- 校验文件存在。
- 校验路径在允许目录内。
- 校验文件大小。
- 读取当前 Feishu context。
- 调用 `FeishuChannel.sendFile()`。
- 返回标准 Pi tool result。

这个工具不应该依赖全局飞书状态，只读取当前 run 绑定的上下文。

### `extensions/index.ts`

Pi extension 入口。

职责：

- 注册 `send_file_to_chat`。
- 注册 `/feishu status`。
- 注册 `/feishu sessions` 或其他 TUI 内命令。
- 添加 prompt guidelines，告诉模型何时主动发文件。

它不应该自己打开飞书连接。飞书连接属于 transport host。

## 配置设计

配置优先级：

1. CLI flags。
2. 项目配置：`.pi/feishu.json`。
3. 用户配置：`~/.pi/agent/feishu.json`。
4. 环境变量。

推荐 schema：

```ts
interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  botName?: string;
  transport: "websocket" | "webhook";
  webhook?: {
    host?: string;
    port: number;
    path: string;
  };
  policy: {
    requireMention: boolean;
    dmEnabled: boolean;
    groupEnabled: boolean;
    allowUsers?: string[];
    allowChats?: string[];
  };
  sessions: {
    privateScope: "per-user";
    groupScope: "shared-chat" | "per-user";
    defaultCwd?: string;
    store: "json" | "sqlite";
    idleTtlMs: number;
  };
  rendering: {
    mode: "stream-card" | "markdown" | "text";
    showThinking: "hide" | "quote" | "plain";
    showToolEvents: boolean;
  };
  files: {
    allowedOutputDirs: string[];
    maxUploadBytes: number;
    tempDir?: string;
  };
}
```

## 飞书命令设计

```text
/help
/sessions
/models
/new
/stop
/reset
/status
```

行为：

- `/help`: 显示帮助卡片。
- `/sessions`: 显示当前会话和可切换会话。
- `/models`: 显示模型选择卡片。
- `/new`: 当前私聊或群聊新建 Pi session。
- `/stop`: 中断当前会话正在生成的任务。
- `/reset`: 清除当前映射并新建 session。
- `/status`: 显示当前模型、session id、队列状态、连接状态。

未知 slash command：

- MVP 不转发。
- 后续可以在安全策略允许时转发给 Pi slash command。

## 数据流

### 普通消息

```text
飞书文本/图片/文件
  -> channel.onMessage
  -> policy 检查
  -> ConversationRouter 生成 sessionKey
  -> SessionHostManager 获取 host
  -> message-normalizer
  -> attachments processor
  -> host.queue.enqueue()
  -> 设置 Feishu context
  -> 设置 Feishu UI context
  -> stream renderer 订阅 session events
  -> runtime.session.prompt()
  -> renderer 更新飞书卡片
  -> 清理 context/temp files
  -> 释放队列
```

### 权限确认

```text
Pi 工具调用需要确认
  -> extension 调用 ctx.ui.confirm()
  -> Feishu UI context 发送确认卡片
  -> 用户点击按钮
  -> card action resolve pending dialog
  -> 工具继续或被拒绝
```

### 中断生成

```text
用户点击 stop 或发送 /stop
  -> card action 或 command 定位 sessionKey
  -> SessionHostManager 找到 active run
  -> runtime.session.abort()
  -> stop 卡片更新为 cancelled
```

### 文件回传

```text
Pi 创建本地文件
  -> 模型调用 send_file_to_chat
  -> 工具校验路径和大小
  -> 读取当前 Feishu context
  -> FeishuChannel.sendFile()
  -> 工具返回成功或失败
```

## 存储设计

MVP 用 JSON 足够，接口预留 SQLite。

```ts
interface FeishuStore {
  getSessionMapping(sessionKey: string): Promise<SessionMapping | undefined>;
  setSessionMapping(mapping: SessionMapping): Promise<void>;
  deleteSessionMapping(sessionKey: string): Promise<void>;
  listSessionMappings(filter?: SessionFilter): Promise<SessionMapping[]>;
}
```

映射结构：

```ts
interface SessionMapping {
  sessionKey: string;
  appId: string;
  tenantKey?: string;
  chatType: "private" | "group";
  chatId: string;
  userId?: string;
  cwd: string;
  sessionFile: string;
  createdAt: string;
  updatedAt: string;
}
```

SQLite 适合后续场景：

- 活跃群和用户很多。
- 需要审计。
- 多 worker 进程。
- 需要 run history 查询。

## 安全策略

MVP 最小策略：

- 群聊默认必须 @bot。
- 支持用户和群 allowlist。
- 不在日志里打印 app secret。
- webhook 模式必须验签。
- 凭证优先放用户配置，不默认放项目配置。
- 文件发送限制在 allowed output dirs。
- 飞书附件作为不可信输入处理。

生产建议：

- 私聊默认开启。
- 群聊可配置开启。
- 项目 cwd 需要显式绑定。
- 危险工具继续依赖 Pi 的权限系统。

## MVP 分期

### Phase 1: 文本可用

- WebSocket channel。
- 配置加载。
- ConversationRouter。
- SessionHostManager。
- 每个活跃会话一个 runtime。
- per-session queue。
- 私聊文本。
- 群聊 @bot 文本。
- markdown 回复。

### Phase 2: Pi 扩展包

- `extensions/index.ts`。
- 注册 `send_file_to_chat`。
- 添加文件回传 prompt guidance。
- package manifest 支持 `pi.extensions`。
- 验证 Pi 包管理器能发现扩展。

### Phase 3: 飞书卡片体验

- streaming card。
- `/help`。
- `/sessions`。
- `/models`。
- stop card。
- model/thinking level card action。
- `ExtensionUIContext` 的 confirm/select 桥接。

### Phase 4: 附件和文件

- 图片输入。
- 小文本文件展开进 prompt。
- 大文件保存到临时目录。
- 生成文件通过 tool 发回飞书。
- 清理和大小限制。

### Phase 5: 生产能力

- webhook transport。
- 签名和加密校验。
- SQLite store。
- 结构化日志。
- allowlist policy。
- 部署文档。
- 完整多租户放到明确有需求后再做。

## 面试亮点

1. 把飞书抽象成 transport，而不是硬编码 bot。
2. 分离 transport host 和 Pi extension，边界清楚。
3. 识别 Pi runtime 是单 active session 模型，因此引入 `SessionHostManager`。
4. 私聊按用户隔离，群聊默认共享上下文，符合真实协作场景。
5. per-session queue 解决并发和状态一致性。
6. stop、stream、permission 都绑定 active run，避免串线。
7. `ExtensionUIContext -> Feishu Card` 让 Pi 原有权限确认能力远程可用。
8. `send_file_to_chat` 作为工具注册，模型可以主动交付文件。
9. 多租户不提前复杂化，只保留字段，体现工程取舍。
10. 从 JSON store 到 SQLite store 的演进路径清晰。

## 待确认问题

1. 群聊是否默认永远共享 session，还是允许某些群配置成按用户隔离？
2. 未知 slash command 是否允许转发给 Pi？
3. 文件是否由模型主动调用工具发送，还是检测到文件生成后自动发送？
4. 飞书消息是否允许默认使用项目 cwd，还是必须先绑定？
5. 第一版是否只需要单进程，还是要预留多 worker？

