import { describe, expect, it } from "vitest";
import { routeConversation } from "../src/bridge/conversation-router.js";
import type { FeishuConfig, FeishuMessage } from "../src/types.js";

/**
 * 会话路由测试：验证私聊/群聊的会话 key 计算、
 * 群聊隔离范围配置、以及未 @机器人时的拒绝逻辑。
 */

/** 构造配置，groupScope 可指定 */
function config(groupScope: "shared-chat" | "per-user" = "shared-chat"): FeishuConfig {
  return {
    appId: "app",
    appSecret: "secret",
    transport: "websocket",
    webhook: { host: "127.0.0.1", port: 8787, path: "/events" },
    policy: { requireMention: true, dmEnabled: true, groupEnabled: true },
    sessions: { privateScope: "per-user", groupScope, defaultCwd: process.cwd(), store: "json", idleTtlMs: 1000 },
    rendering: { mode: "stream-card", showThinking: "quote", showToolEvents: true },
    files: { allowedOutputDirs: [process.cwd()], maxUploadBytes: 1000, tempDir: process.cwd() },
    debug: { logIncomingEvents: false },
  };
}

/** 构造消息，partial 可覆盖默认字段 */
function message(partial: Partial<FeishuMessage>): FeishuMessage {
  return {
    messageId: "m1",
    chatId: "c1",
    chatType: "private",
    userOpenId: "u1",
    text: "hello",
    mentionedBot: false,
    resources: [],
    raw: {},
    ...partial,
  };
}

describe("routeConversation", () => {
  it("routes private chats by user", () => {
    // 私聊按用户隔离：dm:<userOpenId>
    const route = routeConversation(config(), message({ chatType: "private", userOpenId: "alice" }));

    expect(route).toMatchObject({ accepted: true, sessionKey: "dm:alice" });
  });

  it("routes group chats by chat when shared", () => {
    // 群聊 + shared-chat：整群一个会话 group:<chatId>
    const route = routeConversation(
      config(),
      message({ chatType: "group", chatId: "chat-1", userOpenId: "alice", mentionedBot: true }),
    );

    expect(route).toMatchObject({ accepted: true, sessionKey: "group:chat-1" });
  });

  it("routes group chats by chat and user when configured", () => {
    // 群聊 + per-user：每人一个会话 group-user:<chatId>:<userOpenId>
    const route = routeConversation(
      config("per-user"),
      message({ chatType: "group", chatId: "chat-1", userOpenId: "alice", mentionedBot: true }),
    );

    expect(route).toMatchObject({ accepted: true, sessionKey: "group-user:chat-1:alice" });
  });

  it("rejects unmentioned group messages", () => {
    // 要求 @机器人 时，未 @ 的消息应被拒绝
    const route = routeConversation(config(), message({ chatType: "group", mentionedBot: false }));

    expect(route).toEqual({ accepted: false, reason: "Bot was not mentioned" });
  });
});
