import type { JsonObject } from "../types.js";
import { actions, button, card, noteBlock, textBlock } from "./common.js";

/**
 * "正在处理"卡片：每次普通消息入队生成时，先发送这张卡片。
 * 黄色头部 + "停止生成"按钮（danger），点击后由 card-actions 的 cmd: "stop" 分支中止生成。
 */
export function buildStopCard(options: {
  sessionKey: string;
  chatType: "private" | "group";
  senderName?: string;
  sessionMode: string;
}): JsonObject {
  return card("Pi 正在处理", "yellow", [
    textBlock(
      [
        // 群聊中告知正在回复谁
        options.chatType === "group" && options.senderName ? `正在回复：**${options.senderName}**` : "正在生成回复。",
        `会话：\`${options.sessionKey}\``,
        `模式：${options.sessionMode}`,
      ].join("\n"),
    ),
    actions([button("停止生成", { cmd: "stop", sessionKey: options.sessionKey }, "danger")]),
  ]);
}

/**
 * 生成结束卡片：生成完成后把"正在处理"卡片原地更新为这张。
 * title 一般为"Pi 已完成"或"Pi 失败"，message 是结果说明。
 */
export function buildStopDoneCard(title: string, message: string): JsonObject {
  return card(title, "grey", [textBlock(message), noteBlock("这张状态卡会保留在当前聊天中。")]);
}
