import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config/load-config.js";
import { createSendFileToChatTool } from "../tools/send-file-to-chat.js";
import {
  FEISHU_CLI_PROMPT_GUARD,
  FEISHU_NO_CLI_PROMPT_GUARD,
  isBlockedLarkImCommand,
  isLarkCliInstalled,
} from "./lark-cli-guard.js";

/**
 * ============================================================
 * Pi 扩展入口（package.json 的 pi.extensions 指向本文件）
 * ------------------------------------------------------------
 * 以 Pi 扩展方式加载时（在 TUI 里启用 pi-remote-feishu），注册：
 * - /feishu 状态命令
 * - 可选的 lark-cli 技能（检测到 lark-cli 时）
 * - 系统提示词护栏（防止模型乱用 lark-cli im 命令）
 * - bash 工具调用拦截（屏蔽 IM 写/收命令）
 * - send_file_to_chat 工具
 * ============================================================
 */

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDir, "..", "..");
/** skills 目录（lark-doc-cli / lark-im-readonly 两个技能） */
const skillsDir = resolve(packageRoot, "skills");

/**
 * 扩展主函数。
 * 注意：本文件是"TUI 侧"的扩展集成；serve 模式的运行时工具注入在
 * runtime-host.ts 的扩展工厂里（两者独立）。
 */
export default function feishuExtension(pi: ExtensionAPI): void {
  const larkCliInstalled = isLarkCliInstalled();

  // 注册 /feishu 状态命令，方便用户查看扩展加载状态
  pi.registerCommand("feishu", {
    description: "Show Feishu extension status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        larkCliInstalled
          ? "Feishu extension is loaded. Lark CLI skills enabled: lark-doc-cli, lark-im-readonly. IM send/reply/receive commands are guarded."
          : "Feishu extension is loaded. lark-cli was not detected, so Lark CLI skills are disabled. Current-chat transport tools remain available.",
        "info",
      );
    },
  });

  // 检测到 lark-cli 时，把 skills 目录注册为 Pi 可发现的技能
  if (larkCliInstalled) {
    pi.on("resources_discover", () => ({
      skillPaths: [skillsDir],
    }));
  }

  // 在会话启动前注入系统提示词护栏（有/无 lark-cli 两套）
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${larkCliInstalled ? FEISHU_CLI_PROMPT_GUARD : FEISHU_NO_CLI_PROMPT_GUARD}`,
  }));

  // 拦截 bash 工具调用：屏蔽 lark-cli im 的发送/回复/接收等命令
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return undefined;
    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (!isBlockedLarkImCommand(command)) return undefined;
    return {
      block: true,
      reason:
        "Blocked by pi-remote-feishu: lark-cli IM send/reply/receive commands are disabled. Use the Feishu transport or send_file_to_chat for current-chat replies.",
    };
  });

  // 注册 send_file_to_chat 工具；配置缺失时给出警告提示
  try {
    const config = loadConfig();
    pi.registerTool(createSendFileToChatTool(config));
  } catch {
    pi.on("agent_start", (_event, ctx) => {
      ctx.ui.notify("Feishu config not found; send_file_to_chat is not registered.", "warning");
    });
  }
}
