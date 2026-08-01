import { describe, expect, it } from "vitest";
import { processAttachments } from "../src/attachments/processor.js";
import type { FeishuConfig, FeishuMessage } from "../src/types.js";

/** 构造一份测试用最小配置 */
function config(): FeishuConfig {
  return {
    appId: "app",
    appSecret: "secret",
    transport: "websocket",
    webhook: { host: "127.0.0.1", port: 8787, path: "/events" },
    policy: { requireMention: true, dmEnabled: true, groupEnabled: true },
    sessions: { privateScope: "per-user", groupScope: "shared-chat", defaultCwd: process.cwd(), store: "json", idleTtlMs: 1000 },
    rendering: { mode: "stream-card", showThinking: "quote", showToolEvents: true },
    files: { allowedOutputDirs: [process.cwd()], maxUploadBytes: 1000, tempDir: process.cwd() },
    debug: { logIncomingEvents: false },
  };
}

/** 构造一条带两个附件（图片 + 文本文件）的消息 */
function message(): FeishuMessage {
  return {
    messageId: "m1",
    chatId: "chat",
    chatType: "private",
    userOpenId: "user",
    text: "",
    mentionedBot: false,
    resources: [
      { type: "image", fileKey: "img", fileName: "image.png" },
      { type: "file", fileKey: "txt", fileName: "note.txt" },
    ],
    raw: {},
  };
}

describe("processAttachments", () => {
  it("passes supported images and expands small text files", async () => {
    // 模拟下载：图片给二进制内容，文本给 "hello file"
    const downloads = new Map([
      ["img", Buffer.from([1, 2, 3])],
      ["txt", Buffer.from("hello file")],
    ]);
    const result = await processAttachments({
      channel: {
        async downloadResource(_messageId, fileKey) {
          return downloads.get(fileKey) ?? Buffer.from("");
        },
      },
      config: config(),
      message: message(),
      sessionKey: "dm:user",
      supportsImages: true,
    });

    // 图片应进入 images 并推断出 png 的 MIME
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe("image/png");
    // 小文本文件内容应内联进 notes
    expect(result.notes.join("\n")).toContain("hello file");
  });
});
