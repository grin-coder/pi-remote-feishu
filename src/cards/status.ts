import type { JsonObject } from "../types.js";
import { card, noteBlock, textBlock } from "./common.js";

/**
 * 运行状态卡片（/status 命令触发）：
 * 展示连接状态、聊天类型、会话模式、队列深度、是否运行中、当前模型等信息。
 * 头部颜色随连接状态变化（已连接=绿，未连接=红）。
 */
export function buildStatusCard(options: {
  sessionKey: string;
  connected: boolean;
  queueDepth: number;
  active: boolean;
  model?: string;
  chatType: "private" | "group";
  sessionMode: string;
}): JsonObject {
  return card("Pi 飞书状态", options.connected ? "green" : "red", [
    textBlock(
      [
        `**连接状态**：${options.connected ? "已连接" : "未连接"}`,
        `**聊天类型**：${options.chatType === "group" ? "群聊" : "私聊"}`,
        `**会话模式**：${options.sessionMode}`,
        `**队列深度**：${options.queueDepth}`,
        `**运行中**：${options.active ? "是" : "否"}`,
        `**模型**：${options.model ?? "未选择"}`,
      ].join("\n"),
    ),
    noteBlock(`Session：${options.sessionKey}`),
  ]);
}
