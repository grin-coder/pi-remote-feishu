import { randomUUID } from "node:crypto";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { buildPermissionCard, buildPermissionResultCard } from "../cards/permission.js";
import { getFeishuContext } from "../feishu/context.js";

/** 等待中的权限确认弹窗：resolve 回调 + 超时定时器 */
interface PendingDialog {
  resolve(value: string | undefined): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 全局待确认弹窗表：dialogId -> 等待中的回调。
 * Pi 侧 ui.select 发起一张权限卡片后，这里登记回调；
 * 用户在飞书卡片上点击按钮触发 cardAction 时，由 resolvePermissionCardAction 兑现。
 */
const pendingDialogs = new Map<string, PendingDialog>();

/**
 * 兑现一张待确认的权限卡片：
 * 根据卡片按钮携带的 dialogId 找到等待中的 Promise，把用户选择传回去。
 * 返回用户的选择（undefined 表示找不到对应弹窗）。
 */
export function resolvePermissionCardAction(value: Record<string, unknown>): string | undefined {
  const dialogId = typeof value.dialogId === "string" ? value.dialogId : undefined;
  if (!dialogId) return undefined;
  const pending = pendingDialogs.get(dialogId);
  if (!pending) return undefined;
  pendingDialogs.delete(dialogId);
  clearTimeout(pending.timer);
  const choice = typeof value.choice === "string" ? value.choice : undefined;
  pending.resolve(choice);
  return choice;
}

/**
 * 创建"飞书版"的 ExtensionUIContext：
 * 把 Pi 的 ui.select / ui.confirm / notify 等 UI 能力桥接到飞书聊天。
 *
 * - select：发送一张"权限确认"卡片到当前聊天，等待用户在卡片上选择（可中止/超时）
 * - confirm：复用 select，选项固定为 Yes/No
 * - notify：往聊天发送一条普通文本消息
 * - 其余编辑器/TUI 相关方法在飞书模式下为空实现或抛错
 */
export function createFeishuUIContext(): ExtensionUIContext {
  return {
    /**
     * 在飞书聊天里发起一个选择：
     * 发送权限卡片，等待卡片事件 -> 用户点击 -> resolvePermissionCardAction 兑现。
     * 支持 opts.signal 中止和 opts.timeout 超时。
     */
    async select(title, options, opts) {
      const context = getFeishuContext();
      // 不在飞书请求上下文中（比如 TUI 环境），直接选第一个选项兜底
      if (!context) return options[0];
      const dialogId = randomUUID();
      const timeout = opts?.timeout ?? 60_000;

      return await new Promise<string | undefined>((resolve) => {
        // 超时兜底：到时间还没人点就放弃
        const timer = setTimeout(() => {
          pendingDialogs.delete(dialogId);
          resolve(undefined);
        }, timeout);

        pendingDialogs.set(dialogId, { resolve, timer });

        // 支持外部中止信号
        if (opts?.signal) {
          if (opts.signal.aborted) {
            pendingDialogs.delete(dialogId);
            clearTimeout(timer);
            resolve(undefined);
            return;
          }
          opts.signal.addEventListener(
            "abort",
            () => {
              pendingDialogs.delete(dialogId);
              clearTimeout(timer);
              resolve(undefined);
            },
            { once: true },
          );
        }

        // 发送权限卡片到当前聊天；发送失败则直接放弃
        context.channel.sendCard(context.chatId, buildPermissionCard(title, options, dialogId)).catch(() => {
          pendingDialogs.delete(dialogId);
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    },

    /** 确认弹窗：复用 select，选项固定为 Yes / No */
    async confirm(title, message, opts) {
      const text = message ? `${title}\n\n${message}` : title;
      const choice = await this.select(text, ["Yes", "No"], opts);
      return choice === "Yes";
    },

    /** 飞书模式无法做交互式输入，返回 undefined */
    async input() {
      return undefined;
    },

    /** 往当前聊天发送一条通知文本（error/warning 会带前缀） */
    notify(message, type) {
      const context = getFeishuContext();
      if (!context) return;
      const prefix = type === "error" ? "Error: " : type === "warning" ? "Warning: " : "";
      context.channel.sendText(context.chatId, `${prefix}${message}`).catch(() => {});
    },

    /* ---------- 以下为编辑器/TUI 相关方法，飞书模式下不可用 ---------- */
    onTerminalInput() {
      return () => {};
    },
    setStatus() {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    async custom() {
      throw new Error("Custom UI is not available in Feishu mode");
    },
    pasteToEditor() {},
    setEditorText() {},
    getEditorText() {
      return "";
    },
    async editor() {
      return undefined;
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() {
      return undefined;
    },
    get theme() {
      return {} as ExtensionUIContext["theme"];
    },
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false, error: "Themes are not available in Feishu mode" };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };
}

/** 根据卡片事件携带的 value，构建"权限已确认"的结果卡片 */
export function buildResolvedPermissionCard(value: Record<string, unknown>) {
  const choice = resolvePermissionCardAction(value);
  return buildPermissionResultCard(choice);
}
