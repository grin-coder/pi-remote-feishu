import type { JsonObject } from "../types.js";
import { actions, button, card, textBlock } from "./common.js";

/**
 * 权限确认卡片：Pi 的 ui.select 在飞书上的呈现。
 * 每个选项生成一个按钮，按钮 value 携带 dialogId 和该选项，
 * 用户点击后由 card-actions 的 cmd: "permission" 分支兑现等待中的 Promise。
 */
export function buildPermissionCard(title: string, options: string[], dialogId: string): JsonObject {
  return card("Permission required", "red", [
    textBlock(title),
    actions(
      options.map((option, index) =>
        button(option, { cmd: "permission", dialogId, choice: option }, index === 0 ? "primary" : "default"),
      ),
    ),
  ]);
}

/** 权限确认完成后的结果卡片（展示用户选择了什么） */
export function buildPermissionResultCard(choice: string | undefined): JsonObject {
  return card("Permission resolved", "grey", [textBlock(choice ? `Selected: **${choice}**` : "No selection.")]);
}
