import type { JsonObject } from "../types.js";
import { card, noteBlock, textBlock } from "./common.js";

/**
 * 帮助卡片（/help 命令触发）：
 * 列出常用命令、文件能力，以及当前聊天类型/会话模式的说明。
 */
export function buildHelpCard(options: {
  botName: string;
  chatType: "private" | "group";
  sessionMode: string;
  requireMention: boolean;
}): JsonObject {
  return card(`${options.botName} 使用帮助`, "blue", [
    textBlock(
      [
        "**常用命令**",
        "`/help` 查看帮助",
        "`/sessions` 管理当前会话",
        "`/models` 选择模型和思考等级",
        "`/new` 新建 Pi 会话",
        "`/stop` 停止当前生成",
        "`/reset` 重置当前映射",
        "`/status` 查看运行状态",
      ].join("\n"),
    ),
    textBlock(
      [
        "**文件能力**",
        "你让我生成文件时，Pi 可以通过 `send_file_to_chat` 把本地结果发回当前飞书聊天。",
      ].join("\n"),
    ),
    noteBlock(
      [
        `聊天类型：${options.chatType === "group" ? "群聊" : "私聊"}`,
        `会话模式：${options.sessionMode}`,
        options.chatType === "group" && options.requireMention ? "群聊默认需要 @机器人 才会响应。" : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    ),
  ]);
}
