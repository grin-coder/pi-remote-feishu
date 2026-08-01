import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { buildModelsCard, type ModelCardEntry } from "../cards/models.js";
import { buildResolvedPermissionCard } from "./ui-context.js";
import type { FeishuCardAction, FeishuConfig, FeishuIdentity, FeishuStore, JsonObject } from "../types.js";
import type { SessionHostManager } from "./session-host-manager.js";

/**
 * ============================================================
 * 卡片事件处理
 * ------------------------------------------------------------
 * 飞书交互卡片上的按钮/下拉被点击后，会触发 cardAction 事件。
 * 本文件根据按钮 value 中的 cmd 字段分发处理：
 *
 * - permission：权限卡片选择 -> 兑现 ui.select 的 Promise
 * - stop：停止生成
 * - session：会话管理（新建/切换/删除）
 * - model：切换模型 / 思考等级
 * ============================================================
 */

/** 从 value 对象中安全读取字符串字段 */
function readString(value: Record<string, unknown>, key: string): string | undefined {
  const entry = value[key];
  return typeof entry === "string" ? entry : undefined;
}

/**
 * 仅凭 sessionKey 推断身份信息（找不到存储映射时的兜底）：
 * 前缀 dm: -> 私聊；group:/group-user: -> 群聊。
 */
function identityFromSessionKey(config: FeishuConfig, event: FeishuCardAction, sessionKey: string): FeishuIdentity {
  const group = sessionKey.startsWith("group:");
  const groupUser = sessionKey.startsWith("group-user:");
  return {
    appId: config.appId,
    chatType: group || groupUser ? "group" : "private",
    chatId: event.chatId,
    userOpenId: event.userOpenId ?? "unknown",
  };
}

/**
 * 优先从存储里的会话映射恢复完整身份（含 userId、tenantKey），
 * 存储里没有时退回 identityFromSessionKey。
 */
async function identityFromStore(
  config: FeishuConfig,
  store: FeishuStore,
  event: FeishuCardAction,
  sessionKey: string,
): Promise<FeishuIdentity> {
  const mapping = await store.getSessionMapping(sessionKey);
  if (!mapping) return identityFromSessionKey(config, event, sessionKey);
  return {
    appId: config.appId,
    chatType: mapping.chatType,
    chatId: mapping.chatId,
    userOpenId: mapping.userId ?? event.userOpenId ?? "unknown",
    ...(mapping.tenantKey ? { tenantKey: mapping.tenantKey } : {}),
  };
}

/** 从宿主读取可用模型列表（与 message-handler 中的实现一致） */
function modelEntries(host: NonNullable<ReturnType<SessionHostManager["getActiveHost"]>>): ModelCardEntry[] {
  const registry = new ModelRegistry(host.runtime.services.modelRuntime);
  return registry
    .getAvailable()
    .filter((model): model is NonNullable<typeof model> => model !== undefined && model !== null)
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      ...(model.name ? { name: model.name } : {}),
      ...(typeof model.reasoning === "boolean" ? { thinking: model.reasoning } : {}),
    }));
}

/** 根据 sessionKey 前缀生成会话模式的中文说明 */
function sessionModeLabel(sessionKey: string): string {
  if (sessionKey.startsWith("dm:")) {
    return "私聊独立会话";
  }
  if (sessionKey.startsWith("group-user:")) {
    return "群聊按用户隔离";
  }
  return "群聊共享会话";
}

/**
 * 卡片事件处理总入口。
 * 根据 actionValue.cmd 分发到 permission / stop / session / model 分支。
 */
export async function handleCardAction(options: {
  config: FeishuConfig;
  store: FeishuStore;
  manager: SessionHostManager;
  event: FeishuCardAction;
  updateCardByToken(token: string, card: JsonObject): Promise<void>;
}): Promise<void> {
  const value = options.event.actionValue;
  const cmd = readString(value, "cmd");

  // ---- permission：权限卡片选择 ----
  if (cmd === "permission") {
    // 有 token 时顺便把卡片更新为"已确认"状态
    if (options.event.token) {
      await options.updateCardByToken(options.event.token, buildResolvedPermissionCard(value));
    } else {
      buildResolvedPermissionCard(value);
    }
    return;
  }

  const sessionKey = readString(value, "sessionKey");
  if (!sessionKey) return;

  // ---- stop：停止生成 ----
  if (cmd === "stop") {
    await options.manager.abort(sessionKey);
    return;
  }

  // 其余分支需要身份信息（优先用存储里的映射）
  const identity = await identityFromStore(options.config, options.store, options.event, sessionKey);

  // ---- session：会话管理 ----
  if (cmd === "session") {
    const action = readString(value, "action");
    if (action === "new") {
      // 新建会话（清空上下文）
      await options.manager.newSession(sessionKey, identity);
    } else if (action === "switch") {
      // 切换到另一个历史会话
      const targetSessionKey = readString(value, "targetSessionKey");
      if (targetSessionKey) {
        await options.manager.switchToMapping(sessionKey, targetSessionKey, identity);
      }
    } else if (action === "delete") {
      // 删除某个历史会话
      const targetSessionKey = readString(value, "targetSessionKey") ?? sessionKey;
      await options.manager.deleteMapping(targetSessionKey);
    }
    return;
  }

  // ---- model：切换模型 / 思考等级 ----
  if (cmd === "model") {
    const host = await options.manager.getHost(sessionKey, identity);
    const registry = new ModelRegistry(host.runtime.services.modelRuntime);
    const provider = readString(value, "provider");
    const modelId = readString(value, "modelId");
    const thinkingLevel = readString(value, "thinkingLevel") ?? "off";
    if (provider && modelId) {
      const model = registry.find(provider, modelId);
      if (model) {
        await host.runtime.session.setModel(model);
        host.runtime.session.setThinkingLevel(thinkingLevel as Parameters<typeof host.runtime.session.setThinkingLevel>[0]);
      }
    }
    // 有 token 时刷新模型卡片，让界面反映新选择
    if (options.event.token) {
      const current = host.runtime.session.model
        ? {
            provider: host.runtime.session.model.provider,
            id: host.runtime.session.model.id,
            thinkingLevel: host.runtime.session.thinkingLevel,
          }
        : undefined;
      await options.updateCardByToken(
        options.event.token,
        buildModelsCard({
          sessionKey,
          ...(current ? { current } : {}),
          models: modelEntries(host),
          sessionMode: sessionModeLabel(sessionKey),
        }),
      );
    }
  }
}
