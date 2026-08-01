import type { JsonObject, SessionMapping } from "../types.js";
import { actions, button, card, noteBlock, textBlock } from "./common.js";

/** 聊天类型中文标签 */
function chatTypeLabel(chatType: SessionMapping["chatType"]): string {
  return chatType === "group" ? "群聊" : "私聊";
}

/** 截断过长的会话文件路径，避免卡片内容溢出 */
function compactPath(path: string): string {
  return path.length > 72 ? `...${path.slice(-69)}` : path;
}

/**
 * 会话管理卡片（/sessions 命令触发）：
 * 展示"新建会话"按钮，以及最多 10 条持久化的历史会话；
 * 每个历史会话有"切换"和"删除"按钮，点击后由 card-actions 的 cmd: "session" 分支处理。
 */
export function buildSessionsCard(options: {
  currentSessionKey: string;
  mappings: SessionMapping[];
  sessionMode: string;
}): JsonObject {
  const elements: JsonObject[] = [
    textBlock([`**当前会话**`, `\`${options.currentSessionKey}\``, `模式：${options.sessionMode}`].join("\n")),
    actions([button("新建会话", { cmd: "session", action: "new", sessionKey: options.currentSessionKey }, "primary")]),
  ];

  const visibleMappings = options.mappings.slice(0, 10);
  if (visibleMappings.length === 0) {
    elements.push(noteBlock("当前还没有持久化的历史会话。"));
  }

  for (const mapping of visibleMappings) {
    const currentMark = mapping.sessionKey === options.currentSessionKey ? "当前" : "可切换";
    elements.push(
      textBlock(
        [
          `**${chatTypeLabel(mapping.chatType)} · ${currentMark}**`,
          `\`${mapping.sessionKey}\``,
          `更新时间：${mapping.updatedAt}`,
          `文件：${compactPath(mapping.sessionFile)}`,
        ].join("\n"),
      ),
    );
    elements.push(
      actions([
        // 切换：把"当前会话 key"的运行时切换到目标会话文件
        button("切换", {
          cmd: "session",
          action: "switch",
          sessionKey: options.currentSessionKey,
          targetSessionKey: mapping.sessionKey,
        }),
        // 删除：删除目标会话映射（并释放运行时）
        button(
          "删除",
          {
            cmd: "session",
            action: "delete",
            sessionKey: options.currentSessionKey,
            targetSessionKey: mapping.sessionKey,
          },
          "danger",
        ),
      ]),
    );
  }

  if (options.mappings.length > visibleMappings.length) {
    elements.push(noteBlock(`还有 ${options.mappings.length - visibleMappings.length} 个会话未展示。`));
  }

  return card("Pi 会话管理", "blue", elements);
}
