import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { createLarkChannel, LoggerLevel } from "@larksuiteoapi/node-sdk";
import type {
  FeishuCardAction,
  FeishuChannel,
  FeishuMessage,
  FeishuResource,
  JsonObject,
  ReplyOptions,
  SendResult,
} from "../types.js";

/**
 * ============================================================
 * 飞书通道实现
 * ------------------------------------------------------------
 * 封装 @larksuiteoapi/node-sdk 的 WebSocket 通道，向业务层暴露
 * 统一、友好的 FeishuChannel 接口：
 *
 * - SDK 事件 -> 归一化后的 FeishuMessage / FeishuCardAction
 * - 各种 send/stream/update/download 方法 -> Promise 化
 *
 * 注意：这里用 as unknown as RawLarkChannel 做窄接口化，
 * 只声明我们实际用到的 SDK 能力，方便替换实现。
 * ============================================================
 */

/** 创建飞书通道的选项 */
export interface CreateFeishuChannelOptions {
  appId: string;
  appSecret: string;
  logLevel?: string;
  /** 群聊是否要求 @机器人（由 SDK 侧 policy 处理） */
  requireMention: boolean;
}

/** SDK send 返回结果的原始形状（兼容 camelCase / snake_case） */
interface RawSendResult {
  messageId?: string;
  message_id?: string;
}

/** 我们实际使用到的 SDK 通道方法子集 */
interface RawLarkChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  send(chatId: string, content: unknown, options?: unknown): Promise<RawSendResult>;
  stream(chatId: string, producer: unknown, options?: unknown): Promise<void>;
  updateCard(messageId: string, card: unknown): Promise<void>;
  readonly botIdentity?: { name?: string };
  readonly rawClient: {
    request(options: { url: string; method: string; data?: unknown }): Promise<unknown>;
    im: {
      v1: {
        messageResource: {
          /** 下载消息资源，返回可读流 */
          get(options: {
            path: Record<string, string>;
            params: Record<string, string>;
          }): Promise<{ getReadableStream(): AsyncIterable<Buffer | string> }>;
        };
      };
    };
  };
}

/** 日志级别映射：字符串 -> SDK LoggerLevel */
const LOG_LEVELS: Record<string, LoggerLevel> = {
  fatal: LoggerLevel.fatal,
  error: LoggerLevel.error,
  warn: LoggerLevel.warn,
  info: LoggerLevel.info,
  debug: LoggerLevel.debug,
  trace: LoggerLevel.trace,
};

/* ---------- 字段读取辅助（兼容多种命名风格） ---------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

/* ---------- 事件归一化 ---------- */

/** 归一化消息资源列表：只保留有 fileKey 的资源 */
function normalizeResources(value: unknown): FeishuResource[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = asRecord(entry);
    const fileName = readString(record, "fileName") ?? readString(record, "file_name");
    return {
      type: readString(record, "type") ?? "file",
      fileKey: readString(record, "fileKey") ?? readString(record, "file_key") ?? "",
      ...(fileName ? { fileName } : {}),
    };
  }).filter((resource) => resource.fileKey.length > 0);
}

/** 把 SDK 原始消息事件归一化成 FeishuMessage */
function normalizeMessage(value: unknown): FeishuMessage {
  const record = asRecord(value);
  const rawContentType = readString(record, "rawContentType") ?? readString(record, "messageType");
  const chatTypeText = readString(record, "chatType") ?? readString(record, "chat_type") ?? rawContentType;
  // p2p / private 视为私聊，其余（p2p_group 等）视为群聊
  const chatType = chatTypeText === "p2p" || chatTypeText === "private" ? "private" : "group";
  const sender = asRecord(record.sender);
  const senderId = asRecord(sender.sender_id);
  const mentions = Array.isArray(record.mentions) ? record.mentions : [];
  const mentionedBot = readBoolean(record, "mentionedBot") ?? mentions.length > 0;
  const senderName = readString(record, "senderName") ?? readString(sender, "sender_name");
  const tenantKey = readString(record, "tenantKey") ?? readString(record, "tenant_key");

  return {
    messageId: readString(record, "messageId") ?? readString(record, "message_id") ?? "",
    chatId: readString(record, "chatId") ?? readString(record, "chat_id") ?? "",
    chatType,
    userOpenId:
      readString(record, "userOpenId") ??
      readString(record, "openId") ??
      readString(senderId, "open_id") ??
      readString(senderId, "user_id") ??
      "unknown",
    ...(senderName ? { senderName } : {}),
    ...(tenantKey ? { tenantKey } : {}),
    text: readString(record, "content") ?? readString(record, "text") ?? "",
    mentionedBot,
    resources: normalizeResources(record.resources),
    raw: value,
  };
}

/** 把 SDK 原始卡片事件归一化成 FeishuCardAction */
function normalizeCardAction(value: unknown): FeishuCardAction {
  const record = asRecord(value);
  const event = asRecord(record.event);
  const action = asRecord(record.action);
  const operator = asRecord(record.operator);
  const operatorId = asRecord(operator.operator_id);
  const actionValue = asRecord(action.value ?? record.value);
  const messageId = readString(record, "messageId") ?? readString(event, "message_id");
  const userOpenId = readString(record, "userOpenId") ?? readString(operatorId, "open_id");
  const token = readString(record, "token") ?? readString(event, "token");
  return {
    ...(messageId ? { messageId } : {}),
    chatId: readString(record, "chatId") ?? readString(event, "chat_id") ?? "",
    ...(userOpenId ? { userOpenId } : {}),
    actionValue,
    ...(token ? { token } : {}),
    raw: value,
  };
}

/** 归一化发送结果 */
function normalizeSendResult(result: RawSendResult): SendResult {
  return { messageId: result.messageId ?? result.message_id ?? "" };
}

/**
 * 创建飞书通道（FeishuChannel 的唯一实现）。
 * 通过 createLarkChannel 建立 WebSocket 长连接，并包一层统一接口。
 */
export function createFeishuChannel(options: CreateFeishuChannelOptions): FeishuChannel {
  const loggerLevel = LOG_LEVELS[options.logLevel?.toLowerCase() ?? ""] ?? LoggerLevel.warn;
  const raw = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel,
    policy: { requireMention: options.requireMention, dmMode: "open" },
    includeRawEvent: true,
    safety: { chatQueue: { enabled: false } },
  }) as unknown as RawLarkChannel;

  let connected = false;

  return {
    async connect() {
      await raw.connect();
      connected = true;
    },

    async disconnect() {
      await raw.disconnect();
      connected = false;
    },

    /** 注册消息回调（自动归一化） */
    onMessage(handler) {
      raw.on("message", (message) => handler(normalizeMessage(message)));
    },

    /** 注册卡片事件回调（自动归一化） */
    onCardAction(handler) {
      raw.on("cardAction", (event) => handler(normalizeCardAction(event)));
    },

    onError(handler) {
      raw.on("error", (error) => handler(error instanceof Error ? error : new Error(String(error))));
    },

    async sendText(chatId, text, replyOptions) {
      return normalizeSendResult(await raw.send(chatId, { text }, replyOptions));
    },

    async sendMarkdown(chatId, markdown, replyOptions) {
      return normalizeSendResult(await raw.send(chatId, { markdown }, replyOptions));
    },

    async sendCard(chatId, card, replyOptions) {
      return normalizeSendResult(await raw.send(chatId, { card }, replyOptions));
    },

    /** 流式发送 Markdown：producer 里不断 append 增量 */
    async streamMarkdown(chatId, producer, replyOptions) {
      await raw.stream(chatId, { markdown: producer }, replyOptions);
    },

    async updateCard(messageId, card) {
      await raw.updateCard(messageId, card);
    },

    /** 用 token 更新卡片（token 来自卡片事件，无需 messageId） */
    async updateCardByToken(token, card) {
      await raw.rawClient.request({
        url: "/open-apis/interactive/v1/card/update",
        method: "POST",
        data: { token, card },
      });
    },

    /** 发送本地文件（发送前校验路径确实是文件） */
    async sendFile(chatId, filePath, fileName) {
      const statResult = await stat(filePath);
      if (!statResult.isFile()) {
        throw new Error("Path is not a file");
      }
      await raw.send(chatId, {
        file: { source: filePath, fileName: fileName ?? basename(filePath) },
      });
    },

    /** 发送本地图片 */
    async sendImage(chatId, imagePath) {
      const statResult = await stat(imagePath);
      if (!statResult.isFile()) {
        throw new Error("Path is not a file");
      }
      await raw.send(chatId, { image: { source: imagePath } });
    },

    /** 下载消息资源：分块读取可读流并拼成完整 Buffer */
    async downloadResource(messageId, fileKey, type) {
      const response = await raw.rawClient.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      });
      const chunks: Buffer[] = [];
      for await (const chunk of response.getReadableStream()) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },

    get connected() {
      return connected;
    },

    get botName() {
      return raw.botIdentity?.name;
    },
  };
}
