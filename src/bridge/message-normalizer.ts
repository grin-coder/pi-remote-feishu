import type {
  ConversationRoute,
  FeishuCommand,
  FeishuMessage,
  ImageInput,
  NormalizedPiInput,
} from "../types.js";

/** 支持的飞书机器人命令集合（以 / 开头） */
const COMMANDS = new Set(["help", "sessions", "models", "new", "stop", "reset", "status"]);

/**
 * 解析以 / 开头的命令文本。
 * 例如 "/models" -> { name: "models", args: "" }；
 * 不是命令或不在白名单里的命令返回 undefined。
 */
function parseCommand(text: string): FeishuCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const withoutSlash = trimmed.slice(1);
  const [name = "", ...rest] = withoutSlash.split(/\s+/);
  if (!COMMANDS.has(name)) return undefined;
  return {
    name: name as FeishuCommand["name"],
    args: rest.join(" "),
  };
}

/**
 * 去掉群聊消息开头的 @机器人 前缀。
 * 例如 "@Pi check this" -> "check this"。
 */
function stripBotMention(text: string): string {
  return text.replace(/^@\S+\s*/, "").trim();
}

/**
 * 归一化消息：
 * 把飞书消息 + 路由结果 + 附件信息，转换成传给 Pi 的 NormalizedPiInput。
 *
 * 重点：
 * - 群聊文本会剥掉 @机器人 前缀
 * - 群聊会拼入发送者身份和会话模式的上下文说明，让模型知道在群里回复谁
 * - 附件处理结果（文本内容/保存路径/失败原因）会追加到提示词里
 * - 如果消息是 /命令，解析出 command 字段
 */
export function normalizeMessage(options: {
  message: FeishuMessage;
  route: ConversationRoute;
  images?: ImageInput[];
  attachmentNotes?: string[];
}): NormalizedPiInput {
  // 群聊去掉 @前缀，私聊直接 trim
  const text = options.message.chatType === "group" ? stripBotMention(options.message.text) : options.message.text.trim();
  const command = parseCommand(text);
  const attachmentNotes = options.attachmentNotes ?? [];
  const promptTextParts: string[] = [];

  if (text.length > 0) {
    if (options.message.chatType === "group") {
      // 群聊场景：附加一段上下文说明，让模型知道当前会话模式及如何回复
      const sender = options.message.senderName ?? options.message.userOpenId;
      const groupMode = options.route.sessionKey.startsWith("group-user:") ? "per-user session" : "shared chat session";
      promptTextParts.push(
        [
          "[Feishu group message]",
          `Sender: ${sender}`,
          `Session mode: ${groupMode}`,
          "Reply naturally to the sender in the group. Keep the answer concise unless the user asks for detail.",
          "Message:",
          text,
        ].join("\n"),
      );
    } else {
      // 私聊场景：直接使用消息文本
      promptTextParts.push(text);
    }
  }
  if (attachmentNotes.length > 0) {
    promptTextParts.push(attachmentNotes.join("\n"));
  }

  const normalized: NormalizedPiInput = {
    sessionKey: options.route.sessionKey,
    chatId: options.message.chatId,
    messageId: options.message.messageId,
    userId: options.message.userOpenId,
    chatType: options.message.chatType,
    text: promptTextParts.join("\n\n"),
    images: options.images ?? [],
    attachmentNotes,
    ...(options.message.tenantKey ? { tenantKey: options.message.tenantKey } : {}),
    ...(options.message.senderName ? { senderName: options.message.senderName } : {}),
    ...(command ? { command } : {}),
  };

  return normalized;
}
