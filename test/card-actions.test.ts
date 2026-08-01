import { describe, expect, it, vi } from "vitest";
import { handleCardAction } from "../src/bridge/card-actions.js";
import { createFeishuUIContext } from "../src/bridge/ui-context.js";
import { runWithFeishuContext } from "../src/feishu/context.js";
import type { SessionHostManager } from "../src/bridge/session-host-manager.js";
import type { FeishuChannel, FeishuConfig, FeishuStore } from "../src/types.js";

/** 测试用最小配置 */
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

/** 空存储（所有查询都返回空） */
function store(): FeishuStore {
  return {
    getSessionMapping: async () => undefined,
    setSessionMapping: async () => {},
    deleteSessionMapping: async () => {},
    listSessionMappings: async () => [],
  };
}

/** 假通道：只关心 sendCard，其余方法空实现 */
function channel(sendCard: FeishuChannel["sendCard"]): FeishuChannel {
  return {
    connect: async () => {},
    disconnect: async () => {},
    onMessage: () => {},
    onCardAction: () => {},
    onError: () => {},
    sendText: async () => ({ messageId: "m" }),
    sendMarkdown: async () => ({ messageId: "m" }),
    sendCard,
    streamMarkdown: async () => {},
    updateCard: async () => {},
    updateCardByToken: async () => {},
    sendFile: async () => {},
    sendImage: async () => {},
    downloadResource: async () => Buffer.from(""),
    connected: true,
  };
}

describe("handleCardAction", () => {
  it("aborts the matching session key for stop actions", async () => {
    // /stop 或"停止生成"按钮：应把 sessionKey 传给 manager.abort
    const abort = vi.fn<(sessionKey: string) => Promise<boolean>>().mockResolvedValue(true);
    const manager = { abort } as unknown as SessionHostManager;

    await handleCardAction({
      config: config(),
      store: store(),
      manager,
      event: {
        chatId: "chat",
        actionValue: { cmd: "stop", sessionKey: "group:chat" },
        raw: {},
      },
      updateCardByToken: async () => {},
    });

    expect(abort).toHaveBeenCalledWith("group:chat");
  });

  it("resolves permission cards and refreshes the card by token", async () => {
    // 模拟一次 ui.select：发送权限卡片 -> 拿到按钮 value -> 触发 cardAction 兑现
    const sendCard = vi.fn<FeishuChannel["sendCard"]>().mockResolvedValue({ messageId: "permission-card" });
    const ui = createFeishuUIContext();
    const cfg = config();
    const selected = runWithFeishuContext(
      {
        sessionKey: "dm:user",
        chatId: "chat",
        channel: channel(sendCard),
        uiContext: ui,
        config: cfg,
      },
      async () => await ui.select("Allow?", ["Yes", "No"]),
    );

    // 从发出的卡片里取出第一个按钮的 value（dialogId + choice）
    const sentCard = sendCard.mock.calls[0]?.[1];
    const elements = sentCard?.elements;
    const actionBlock = Array.isArray(elements) ? elements.find((entry) => typeof entry === "object" && entry !== null && "actions" in entry) : undefined;
    const actions = typeof actionBlock === "object" && actionBlock !== null && "actions" in actionBlock ? actionBlock.actions : undefined;
    const firstButton = Array.isArray(actions) ? actions[0] : undefined;
    const value = typeof firstButton === "object" && firstButton !== null && "value" in firstButton ? firstButton.value : undefined;
    const actionValue = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const updateCardByToken = vi.fn<(token: string, card: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);

    // 模拟用户点击按钮触发 cardAction
    await handleCardAction({
      config: cfg,
      store: store(),
      manager: { abort: async () => false } as unknown as SessionHostManager,
      event: {
        chatId: "chat",
        actionValue,
        token: "token",
        raw: {},
      },
      updateCardByToken,
    });

    // ui.select 应兑现为 "Yes"，并且卡片被原地更新（用 token）
    await expect(selected).resolves.toBe("Yes");
    expect(updateCardByToken).toHaveBeenCalledWith("token", expect.objectContaining({ config: { wide_screen_mode: true } }));
  });
});
