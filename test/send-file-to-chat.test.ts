import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFeishuUIContext } from "../src/bridge/ui-context.js";
import { runWithFeishuContext } from "../src/feishu/context.js";
import { createSendFileToChatTool } from "../src/tools/send-file-to-chat.js";
import type { FeishuChannel, FeishuConfig } from "../src/types.js";

/**
 * send_file_to_chat 工具测试：
 * 验证在飞书上下文内能正常发文件，以及目录白名单校验会拒绝越界文件。
 */

/** 构造配置，允许输出的目录由参数指定 */
function config(dir: string): FeishuConfig {
  return {
    appId: "app",
    appSecret: "secret",
    transport: "websocket",
    webhook: { host: "127.0.0.1", port: 8787, path: "/events" },
    policy: { requireMention: true, dmEnabled: true, groupEnabled: true },
    sessions: { privateScope: "per-user", groupScope: "shared-chat", defaultCwd: dir, store: "json", idleTtlMs: 1000 },
    rendering: { mode: "stream-card", showThinking: "quote", showToolEvents: true },
    files: { allowedOutputDirs: [dir], maxUploadBytes: 1000, tempDir: dir },
    debug: { logIncomingEvents: false },
  };
}

/** 假通道：只关心 sendFile，其余方法空实现 */
function fakeChannel(sendFile: FeishuChannel["sendFile"]): FeishuChannel {
  return {
    connect: async () => {},
    disconnect: async () => {},
    onMessage: () => {},
    onCardAction: () => {},
    onError: () => {},
    sendText: async () => ({ messageId: "m" }),
    sendMarkdown: async () => ({ messageId: "m" }),
    sendCard: async () => ({ messageId: "m" }),
    streamMarkdown: async (_chatId, producer) => {
      await producer({ append: async () => {} });
    },
    updateCard: async () => {},
    updateCardByToken: async () => {},
    sendFile,
    sendImage: async () => {},
    downloadResource: async () => Buffer.from(""),
    connected: true,
    botName: "bot",
  };
}

describe("send_file_to_chat", () => {
  it("sends files using current Feishu context", async () => {
    // 在临时目录创建文件，并在飞书上下文里调用工具
    const dir = join(tmpdir(), `pi-remote-feishu-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "result.txt");
    writeFileSync(filePath, "ok");
    const sendFile = vi.fn<FeishuChannel["sendFile"]>().mockResolvedValue(undefined);
    const cfg = config(dir);
    const tool = createSendFileToChatTool(cfg);

    try {
      const result = await runWithFeishuContext(
        {
          sessionKey: "dm:user",
          chatId: "chat",
          channel: fakeChannel(sendFile),
          uiContext: createFeishuUIContext(),
          config: cfg,
        },
        async () =>
          await tool.execute(
            "tool-call",
            { filePath },
            undefined,
            undefined,
            {} as Parameters<typeof tool.execute>[4],
          ),
      );

      // 文件应被发送到当前 chat，文件名取自原文件名
      expect(sendFile).toHaveBeenCalledWith("chat", filePath, "result.txt");
      expect(result.content[0]?.type).toBe("text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects files outside allowed output directories", async () => {
    // 文件在允许目录之外：不应发送，且返回提示信息
    const allowedDir = join(tmpdir(), `pi-remote-feishu-tool-allowed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outsideDir = join(tmpdir(), `pi-remote-feishu-tool-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(allowedDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    const filePath = join(outsideDir, "secret.txt");
    writeFileSync(filePath, "no");
    const sendFile = vi.fn<FeishuChannel["sendFile"]>().mockResolvedValue(undefined);
    const cfg = config(allowedDir);
    const tool = createSendFileToChatTool(cfg);

    try {
      const result = await runWithFeishuContext(
        {
          sessionKey: "dm:user",
          chatId: "chat",
          channel: fakeChannel(sendFile),
          uiContext: createFeishuUIContext(),
          config: cfg,
        },
        async () =>
          await tool.execute(
            "tool-call",
            { filePath },
            undefined,
            undefined,
            {} as Parameters<typeof tool.execute>[4],
          ),
      );

      expect(sendFile).not.toHaveBeenCalled();
      expect(result.content[0]?.type).toBe("text");
      const firstContent = result.content[0];
      expect(firstContent?.type === "text" ? firstContent.text : "").toContain("outside allowed output directories");
    } finally {
      rmSync(allowedDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
