import type { AgentSessionRuntime, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/**
 * ============================================================
 * pi-remote-feishu 核心类型定义
 * ------------------------------------------------------------
 * 本文件定义了整个 pi-remote-feishu 扩展对外、对内使用的全部类型。
 * 数据流概览：
 *
 *  飞书消息(FeishuMessage) -> 路由(routeConversation) -> 归一化(normalizeMessage)
 *    -> Pi 运行时(prompt) -> 流式渲染(stream-renderer) -> 回发到飞书聊天
 *
 * 本文件只包含纯类型，不含任何逻辑。
 * ============================================================
 */

/** 聊天类型：私聊 或 群聊 */
export type ChatType = "private" | "group";
/** 群聊会话隔离范围：整个群共享一个会话 / 群里每个用户一个会话 */
export type GroupScope = "shared-chat" | "per-user";
/** 会话持久化存储类型：JSON 文件 / SQLite（SQLite 暂未实现） */
export type StoreKind = "json" | "sqlite";
/** 回复渲染模式：流式卡片 / Markdown / 纯文本 */
export type RenderingMode = "stream-card" | "markdown" | "text";
/** 思考过程(thinking)展示方式：隐藏 / 引用块(> 前缀) / 原文输出 */
export type ThinkingRenderMode = "hide" | "quote" | "plain";

/** 消息接入策略：谁可以跟机器人对话 */
export interface FeishuPolicyConfig {
  /** 群聊中是否必须 @机器人 才响应 */
  requireMention: boolean;
  /** 是否允许私聊 */
  dmEnabled: boolean;
  /** 是否允许群聊 */
  groupEnabled: boolean;
  /** 允许的用户 open_id 白名单（缺省表示全部允许） */
  allowUsers?: string[];
  /** 允许的聊天 chat_id 白名单（缺省表示全部允许） */
  allowChats?: string[];
}

/** 会话管理配置 */
export interface FeishuSessionsConfig {
  /** 私聊固定为 per-user（每个用户独立会话），当前不支持其他值 */
  privateScope: "per-user";
  /** 群聊的会话隔离策略 */
  groupScope: GroupScope;
  /** Pi 运行时默认的工作目录 */
  defaultCwd?: string;
  /** 会话映射的存储方式 */
  store: StoreKind;
  /** 空闲会话自动回收的毫秒数（超时后释放 Pi runtime） */
  idleTtlMs: number;
}

/** 回复渲染配置 */
export interface FeishuRenderingConfig {
  /** 渲染模式 */
  mode: RenderingMode;
  /** 思考过程的展示方式 */
  showThinking: ThinkingRenderMode;
  /** 是否把工具调用过程(如 Running tool)输出到聊天里 */
  showToolEvents: boolean;
}

/** 文件能力配置 */
export interface FeishuFilesConfig {
  /** 允许回传给聊天的输出目录白名单（send_file_to_chat 工具会校验） */
  allowedOutputDirs: string[];
  /** 回传文件的最大字节数 */
  maxUploadBytes: number;
  /** 附件临时下载目录（默认系统临时目录下的 pi-remote-feishu） */
  tempDir?: string;
}

/** 调试配置 */
export interface FeishuDebugConfig {
  /** 是否打印收到的消息/卡片事件摘要，便于排查问题 */
  logIncomingEvents: boolean;
}

/** Webhook 传输配置（v1 版本暂未实现，仅占位） */
export interface FeishuWebhookConfig {
  host?: string;
  port: number;
  path: string;
}

/** 完整配置：由 load-config 合并 环境变量 + 配置文件 + CLI 参数 后生成 */
export interface FeishuConfig {
  /** 飞书应用 App ID */
  appId: string;
  /** 飞书应用 App Secret */
  appSecret: string;
  /** 加密密钥（webhook 模式使用） */
  encryptKey?: string;
  /** 验证令牌（webhook 模式使用） */
  verificationToken?: string;
  /** 机器人显示名称 */
  botName?: string;
  /** 传输方式：目前只有 websocket 可用 */
  transport: "websocket" | "webhook";
  webhook?: FeishuWebhookConfig;
  policy: FeishuPolicyConfig;
  sessions: FeishuSessionsConfig;
  rendering: FeishuRenderingConfig;
  files: FeishuFilesConfig;
  debug: FeishuDebugConfig;
}

/** 标识"一条消息来自哪里"，用于路由和会话隔离 */
export interface FeishuIdentity {
  appId: string;
  tenantKey?: string;
  chatType: ChatType;
  chatId: string;
  userOpenId: string;
  senderName?: string;
}

/** 消息携带的附件资源（图片 / 文件 / 音频 / 视频 / 表情包等） */
export interface FeishuResource {
  type: "image" | "file" | "audio" | "video" | "sticker" | string;
  /** 飞书侧的文件 key，用于下载 */
  fileKey: string;
  fileName?: string;
  size?: number;
}

/** 归一化后的飞书消息（channel 层把 SDK 原始事件转换成这个结构） */
export interface FeishuMessage {
  messageId: string;
  chatId: string;
  chatType: ChatType;
  userOpenId: string;
  senderName?: string;
  tenantKey?: string;
  /** 消息文本内容 */
  text: string;
  /** 是否 @了机器人 */
  mentionedBot: boolean;
  /** 附件资源列表 */
  resources: FeishuResource[];
  /** 原始事件，便于调试 */
  raw: unknown;
}

/** 飞书交互卡片上按钮/下拉菜单被点击后触发的事件 */
export interface FeishuCardAction {
  messageId?: string;
  chatId: string;
  userOpenId?: string;
  /** 按钮上 value 字段携带的负载（cmd、sessionKey 等都在这里） */
  actionValue: Record<string, unknown>;
  /** 卡片更新令牌，可用它原地更新卡片内容 */
  token?: string;
  raw: unknown;
}

/** 回复选项：replyTo 表示回复哪条消息（飞书里会形成引用回复） */
export interface ReplyOptions {
  replyTo?: string;
}

/** 发送结果 */
export interface SendResult {
  messageId: string;
}

/** 流式写入器：渲染过程把增量文本一段段写进来 */
export interface StreamWriter {
  append(chunk: string): Promise<void>;
}

/**
 * 飞书通道抽象：所有跟飞书 SDK 的交互都封装在这个接口后面。
 * 实现见 src/feishu/channel.ts
 */
export interface FeishuChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** 注册消息回调 */
  onMessage(handler: (message: FeishuMessage) => void): void;
  /** 注册卡片事件回调 */
  onCardAction(handler: (event: FeishuCardAction) => void): void;
  onError(handler: (error: Error) => void): void;
  /** 发送纯文本 */
  sendText(chatId: string, text: string, options?: ReplyOptions): Promise<SendResult>;
  /** 发送 Markdown 文本 */
  sendMarkdown(chatId: string, markdown: string, options?: ReplyOptions): Promise<SendResult>;
  /** 发送交互卡片 */
  sendCard(chatId: string, card: JsonObject, options?: ReplyOptions): Promise<SendResult>;
  /** 以流式方式发送 Markdown：producer 回调里不断 append 增量内容 */
  streamMarkdown(
    chatId: string,
    producer: (writer: StreamWriter) => Promise<void>,
    options?: ReplyOptions,
  ): Promise<void>;
  /** 按 messageId 更新一张已发送的卡片 */
  updateCard(messageId: string, card: JsonObject): Promise<void>;
  /** 按 token 更新一张卡片（token 来自卡片事件） */
  updateCardByToken(token: string, card: JsonObject): Promise<void>;
  /** 发送本地文件到聊天 */
  sendFile(chatId: string, filePath: string, fileName?: string): Promise<void>;
  /** 发送本地图片到聊天 */
  sendImage(chatId: string, imagePath: string): Promise<void>;
  /** 下载消息中的附件资源，返回 Buffer */
  downloadResource(messageId: string, fileKey: string, type: string): Promise<Buffer>;
  readonly connected: boolean;
  readonly botName?: string | undefined;
}

/** 飞书聊天里以 / 开头的机器人命令 */
export interface FeishuCommand {
  name: "help" | "sessions" | "models" | "new" | "stop" | "reset" | "status";
  args: string;
}

/** 传给 Pi 的图片输入（base64 编码） */
export interface ImageInput {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * 归一化后的 Pi 输入：把飞书消息、路由结果、附件信息统一打包，
 * 供 runtime-host 直接调用 Pi 会话。
 */
export interface NormalizedPiInput {
  /** 会话 key（dm:xxx / group:xxx / group-user:xxx:xxx） */
  sessionKey: string;
  chatId: string;
  messageId: string;
  userId: string;
  tenantKey?: string;
  chatType: ChatType;
  senderName?: string;
  /** 拼装好的提示词文本（含群聊上下文、附件说明等） */
  text: string;
  images: ImageInput[];
  /** 附件处理后的文字说明（文本内容 / 已保存路径 / 失败原因） */
  attachmentNotes: string[];
  /** 若消息是 /命令 则解析出命令 */
  command?: FeishuCommand;
}

/** 会话映射：把 sessionKey 与 Pi 的会话文件、工作目录关联起来，实现跨进程持久化 */
export interface SessionMapping {
  sessionKey: string;
  appId: string;
  tenantKey?: string;
  chatType: ChatType;
  chatId: string;
  userId?: string;
  /** Pi 会话的工作目录 */
  cwd: string;
  /** Pi 会话文件路径（jsonl），可用 SessionManager.open 恢复会话 */
  sessionFile: string;
  createdAt: string;
  updatedAt: string;
}

/** 查询会话映射的过滤条件 */
export interface SessionFilter {
  chatId?: string;
  userId?: string;
  chatType?: ChatType;
}

/** 会话映射存储抽象（实现：JSON 文件存储） */
export interface FeishuStore {
  getSessionMapping(sessionKey: string): Promise<SessionMapping | undefined>;
  setSessionMapping(mapping: SessionMapping): Promise<void>;
  deleteSessionMapping(sessionKey: string): Promise<void>;
  listSessionMappings(filter?: SessionFilter): Promise<SessionMapping[]>;
}

/** 路由成功：消息被接受，得到会话 key 和身份信息 */
export interface ConversationRoute {
  accepted: true;
  sessionKey: string;
  identity: FeishuIdentity;
}

/** 路由拒绝：附上拒绝原因（如"未 @机器人"、"用户不在白名单"） */
export interface RejectedConversationRoute {
  accepted: false;
  reason: string;
}

/** 路由结果：成功或拒绝二选一 */
export type ConversationRouteResult = ConversationRoute | RejectedConversationRoute;

/** 一次正在进行的生成运行（用于 /stop 中止） */
export interface ActiveRun {
  sessionKey: string;
  chatId: string;
  messageId: string;
  startedAt: Date;
  abort(): Promise<void>;
}

/** 一个会话宿主：包含 Pi 运行时 + 消息队列 + 最近使用时间 */
export interface SessionHost {
  sessionKey: string;
  runtime: AgentSessionRuntime;
  queue: PromptQueueLike;
  activeRun?: ActiveRun;
  lastUsedAt: Date;
}

/** 队列接口：保证同一会话内的提示词串行执行 */
export interface PromptQueueLike {
  enqueue<T>(run: () => Promise<T>): Promise<T>;
}

/**
 * 飞书运行上下文：在一次"飞书请求 -> Pi 生成"的过程中，
 * 通过 AsyncLocalStorage 传递，供 send_file_to_chat、ui.select 等能力读取。
 */
export interface FeishuRunContext {
  sessionKey: string;
  chatId: string;
  messageId?: string;
  channel: FeishuChannel;
  uiContext: ExtensionUIContext;
  config: FeishuConfig;
}

/* ---------- 通用 JSON 类型（飞书卡片结构用） ---------- */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
