import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonFeishuStore } from "../src/store/json-store.js";
import type { SessionMapping } from "../src/types.js";

/** 构造一条测试用会话映射 */
function mapping(sessionKey: string): SessionMapping {
  return {
    sessionKey,
    appId: "app",
    chatType: "private",
    chatId: "chat",
    userId: "user",
    cwd: process.cwd(),
    sessionFile: `${sessionKey}.jsonl`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("JsonFeishuStore", () => {
  it("writes, lists, filters, and deletes mappings", async () => {
    // 用独立临时目录里的 sessions.json 做读写测试
    const dir = join(tmpdir(), `pi-remote-feishu-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const store = new JsonFeishuStore(join(dir, "sessions.json"));

    try {
      await store.setSessionMapping(mapping("dm:alice"));
      await store.setSessionMapping({ ...mapping("dm:bob"), userId: "bob" });

      // 按 key 查询
      expect(await store.getSessionMapping("dm:alice")).toMatchObject({ sessionKey: "dm:alice" });
      // 按 userId 过滤
      expect(await store.listSessionMappings({ userId: "bob" })).toHaveLength(1);

      // 删除后查不到
      await store.deleteSessionMapping("dm:alice");
      expect(await store.getSessionMapping("dm:alice")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
