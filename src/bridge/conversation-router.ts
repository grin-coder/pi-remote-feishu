import type { ConversationRouteResult, FeishuConfig, FeishuIdentity, FeishuMessage } from "../types.js";

/**
 * 白名单判断：列表未定义（未配置）表示全部允许。
 */
function contains(list: readonly string[] | undefined, value: string): boolean {
  return list === undefined || list.includes(value);
}

/**
 * 会话路由：决定一条飞书消息是否被接受。
 *
 * 依次检查：
 * 1. 私聊是否开启
 * 2. 群聊是否开启
 * 3. 群聊是否要求 @机器人（未 @ 则拒绝）
 * 4. 用户是否在允许名单
 * 5. 聊天是否在允许名单
 *
 * 通过后返回会话 key 和身份信息（identity）。
 */
export function routeConversation(config: FeishuConfig, message: FeishuMessage): ConversationRouteResult {
  if (message.chatType === "private" && !config.policy.dmEnabled) {
    return { accepted: false, reason: "Private chats are disabled" };
  }
  if (message.chatType === "group" && !config.policy.groupEnabled) {
    return { accepted: false, reason: "Group chats are disabled" };
  }
  if (message.chatType === "group" && config.policy.requireMention && !message.mentionedBot) {
    return { accepted: false, reason: "Bot was not mentioned" };
  }
  if (!contains(config.policy.allowUsers, message.userOpenId)) {
    return { accepted: false, reason: "User is not allowed" };
  }
  if (!contains(config.policy.allowChats, message.chatId)) {
    return { accepted: false, reason: "Chat is not allowed" };
  }

  // 收集身份信息，用于会话隔离和持久化映射
  const identity: FeishuIdentity = {
    appId: config.appId,
    chatType: message.chatType,
    chatId: message.chatId,
    userOpenId: message.userOpenId,
    ...(message.tenantKey ? { tenantKey: message.tenantKey } : {}),
    ...(message.senderName ? { senderName: message.senderName } : {}),
  };

  return {
    accepted: true,
    sessionKey: buildSessionKey(config, identity),
    identity,
  };
}

/**
 * 计算会话 key（决定会话隔离粒度）：
 * - 私聊：dm:<userOpenId>（每个用户独立会话）
 * - 群聊 + shared-chat：group:<chatId>（整群共享一个会话）
 * - 群聊 + per-user：group-user:<chatId>:<userOpenId>（群里每人独立会话）
 */
export function buildSessionKey(config: FeishuConfig, identity: FeishuIdentity): string {
  if (identity.chatType === "private") {
    return `dm:${identity.userOpenId}`;
  }
  if (config.sessions.groupScope === "per-user") {
    return `group-user:${identity.chatId}:${identity.userOpenId}`;
  }
  return `group:${identity.chatId}`;
}
