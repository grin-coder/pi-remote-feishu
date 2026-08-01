import { describe, expect, it } from "vitest";
import { normalizeMessage } from "../src/bridge/message-normalizer.js";
import type { ConversationRoute, FeishuMessage } from "../src/types.js";

/**
 * 消息归一化测试：
 * 验证群聊上下文拼接（发送者身份）和 /命令 解析。
 */

/** 一个群聊共享会话的路由 */
const route: ConversationRoute = {
  accepted: true,
  sessionKey: "group:chat-1",
  identity: {
    appId: "app",
    chatType: "group",
    chatId: "chat-1",
    userOpenId: "alice",
    senderName: "Alice",
  },
};

/** 构造一条群聊消息（默认 @了机器人） */
function message(text: string): FeishuMessage {
  return {
    messageId: "m1",
    chatId: "chat-1",
    chatType: "group",
    userOpenId: "alice",
    senderName: "Alice",
    text,
    mentionedBot: true,
    resources: [],
    raw: {},
  };
}

describe("normalizeMessage", () => {
  it("includes sender name for group prompts", () => {
    // 群聊提示词应包含发送者身份，且剥掉 @机器人 前缀
    const input = normalizeMessage({ message: message("@Pi check this"), route });

    expect(input.text).toContain("Sender: Alice");
    expect(input.text).toContain("check this");
  });

  it("detects supported Feishu commands", () => {
    // /models 应被解析成命令
    const input = normalizeMessage({ message: message("/models"), route });

    expect(input.command).toEqual({ name: "models", args: "" });
  });
});
