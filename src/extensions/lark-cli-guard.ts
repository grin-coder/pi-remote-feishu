import { spawnSync } from "node:child_process";

/**
 * ============================================================
 * lark-cli 护栏
 * ------------------------------------------------------------
 * 防止模型通过 bash 使用 lark-cli 的 IM 写/收命令
 * （发送、回复、转发、删除、更新、接收、监听等），
 * 确保飞书会话内的消息回发走 pi-remote-feishu 自己的传输通道。
 *
 * 允许保留的能力：
 * - lark-doc-cli：飞书文档读写
 * - lark-im-readonly：只读的 IM 查询（查聊天、列成员、搜消息、下资源）
 * ============================================================
 */

/** 被拦截的 lark-cli im 动作（+xxx 子命令名） */
const BLOCKED_LARK_IM_ACTIONS = [
  "messages-send",
  "messages-reply",
  "messages-forward",
  "messages-delete",
  "messages-update",
  "messages-receive",
  "messages-listen",
  "events-receive",
  "events-listen",
] as const;

/** 检测本机是否安装了 lark-cli（运行 `lark-cli --version`） */
export function isLarkCliInstalled(): boolean {
  const result = spawnSync("lark-cli", ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

/** 命令里是否包含 lark-cli im（含 npx 前缀的写法） */
function hasLarkImCommand(command: string): boolean {
  return /\blark-cli\s+im\b/.test(command) || /\bnpx\s+lark-cli\s+im\b/.test(command);
}

/**
 * 判断一条 bash 命令是否需要被拦截：
 * 仅当它调用 lark-cli im 且包含被禁动作时才拦截。
 * 动作匹配使用 +action 或 action 两种写法均可（正则做了转义）。
 */
export function isBlockedLarkImCommand(command: string): boolean {
  if (!hasLarkImCommand(command)) return false;
  return BLOCKED_LARK_IM_ACTIONS.some((action) => {
    const escaped = action.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`(?:\\+|\\b)${escaped}\\b`).test(command);
  });
}

/** 系统提示词护栏：检测到 lark-cli 时注入（允许文档/只读 IM，禁止 IM 写/收） */
export const FEISHU_CLI_PROMPT_GUARD = `
## Feishu CLI Boundary

This session may expose Lark CLI skills for Feishu documents and read-only IM inspection.

- Use lark-doc-cli for Feishu document tasks such as fetching, creating, updating, and inserting media into docs.
- Use lark-im-readonly only for read-only IM tasks such as looking up chats, listing members, searching existing messages, or downloading message resources.
- Do not use lark-cli IM commands to send, reply, forward, delete, update, receive, or listen for messages.
- In a Feishu-triggered run, the pi-remote-feishu transport is the only normal reply channel back to the current chat.
- To return generated local files to the current Feishu chat, use send_file_to_chat instead of manually sending IM messages with lark-cli.
`;

/** 系统提示词护栏：未检测到 lark-cli 时注入 */
export const FEISHU_NO_CLI_PROMPT_GUARD = `
## Feishu CLI Boundary

The lark-cli executable was not detected when pi-remote-feishu loaded.

- Do not attempt to use lark-cli commands unless the user installs and authenticates lark-cli, then reloads Pi.
- Use pi-remote-feishu transport features for the current Feishu chat.
- To return generated local files to the current Feishu chat, use send_file_to_chat.
- If the user asks to read or edit a Feishu document and no SDK document tool is available yet, ask for the document link or token and explain that SDK document tooling is not implemented in this extension version.
`;
