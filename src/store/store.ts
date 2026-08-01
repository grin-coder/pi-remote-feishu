import { join } from "node:path";
import type { FeishuConfig, FeishuStore } from "../types.js";
import { JsonFeishuStore } from "./json-store.js";

/**
 * 存储工厂：根据配置创建对应的 FeishuStore 实现。
 * 目前只支持 json（sqlite 预留但未实现）。
 * 会话映射文件放在 files.tempDir 下的 sessions.json。
 */
export function createStore(config: FeishuConfig): FeishuStore {
  if (config.sessions.store === "sqlite") {
    throw new Error('SQLite store is not implemented yet; use sessions.store = "json"');
  }
  const baseDir = config.files.tempDir ?? ".";
  return new JsonFeishuStore(join(baseDir, "sessions.json"));
}
