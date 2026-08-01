import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { processAttachments } from "../attachments/processor.js";
import { buildHelpCard } from "../cards/help.js";
import { buildModelsCard, type ModelCardEntry } from "../cards/models.js";
import { buildSessionsCard } from "../cards/sessions.js";
import { buildStatusCard } from "../cards/status.js";
import { buildStopCard, buildStopDoneCard } from "../cards/stop.js";
import { cleanupTempAttachments } from "../attachments/temp-files.js";
import type { FeishuChannel, FeishuConfig, FeishuMessage, FeishuStore, NormalizedPiInput } from "../types.js";
import { normalizeMessage } from "./message-normalizer.js";
import { routeConversation } from "./conversation-router.js";
import type { SessionHostManager } from "./session-host-manager.js";

/**
 * ============================================================
 * 飞书消息处理总入口
 * ------------------------------------------------------------
 * 流程：路由 -> 取宿主 -> 处理附件 -> 归一化消息 -> 命令或生成
 *
 * 命令（/help 等）由 handleCommand 直接响应；
 * 普通消息通过 host.queue 串行进入 Pi 会话生成，
 * 同时会先发送一张"正在处理"卡片（带"停止生成"按钮），
 * 结束后更新为"完成/失败"卡片。
 * ============================================================
 */

/** 从宿主运行时读取当前可用的模型列表，用于 /models 卡片展示 */
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

/** 根据聊天类型和配置生成会话模式的中文说明 */
function sessionModeLabel(config: FeishuConfig, input: Pick<NormalizedPiInput, "chatType">): string {
  if (input.chatType === "private") {
    return "私聊独立会话";
  }
  return config.sessions.groupScope === "per-user" ? "群聊按用户隔离" : "群聊共享会话";
}

/**
 * 处理飞书聊天里的 / 命令。
 * 返回 true 表示已处理（调用方无需再走生成流程）。
 * 支持的命令：help / new / reset / stop / sessions / models / status
 */
async function handleCommand(options: {
  input: NormalizedPiInput;
  config: FeishuConfig;
  channel: FeishuChannel;
  store: FeishuStore;
  manager: SessionHostManager;
}): Promise<boolean> {
  const command = options.input.command;
  if (!command) return false;

  // 命令操作时使用的身份信息（来自归一化输入）
  const routeIdentity = {
    appId: options.config.appId,
    chatType: options.input.chatType,
    chatId: options.input.chatId,
    userOpenId: options.input.userId,
    ...(options.input.tenantKey ? { tenantKey: options.input.tenantKey } : {}),
    ...(options.input.senderName ? { senderName: options.input.senderName } : {}),
  };

  // /help：发送帮助卡片
  if (command.name === "help") {
    await options.channel.sendCard(
      options.input.chatId,
      buildHelpCard({
        botName: options.config.botName ?? "Pi Agent",
        chatType: options.input.chatType,
        sessionMode: sessionModeLabel(options.config, options.input),
        requireMention: options.config.policy.requireMention,
      }),
      {
        replyTo: options.input.messageId,
      },
    );
    return true;
  }

  // /new 新建会话；/reset 先删除映射再新建
  if (command.name === "new" || command.name === "reset") {
    if (command.name === "reset") {
      await options.manager.deleteMapping(options.input.sessionKey);
    }
    await options.manager.newSession(options.input.sessionKey, routeIdentity);
    await options.channel.sendText(options.input.chatId, "已创建新的 Pi 会话。", { replyTo: options.input.messageId });
    return true;
  }

  // /stop：中止当前生成
  if (command.name === "stop") {
    const stopped = await options.manager.abort(options.input.sessionKey);
    await options.channel.sendText(options.input.chatId, stopped ? "已请求停止当前生成。" : "当前没有运行中的生成。", {
      replyTo: options.input.messageId,
    });
    return true;
  }

  // 下面几个命令需要宿主（会按需创建运行时）
  const host = await options.manager.getHost(options.input.sessionKey, routeIdentity);

  // /sessions：发送会话管理卡片（列出持久化的历史会话，支持切换/删除）
  if (command.name === "sessions") {
    await options.channel.sendCard(
      options.input.chatId,
      buildSessionsCard({
        currentSessionKey: options.input.sessionKey,
        mappings: await options.store.listSessionMappings(),
        sessionMode: sessionModeLabel(options.config, options.input),
      }),
      { replyTo: options.input.messageId },
    );
    return true;
  }

  // /models：发送模型选择卡片（展示当前模型和可用模型列表）
  if (command.name === "models") {
    const current = host.runtime.session.model
      ? {
          provider: host.runtime.session.model.provider,
          id: host.runtime.session.model.id,
          thinkingLevel: host.runtime.session.thinkingLevel,
        }
      : undefined;
    await options.channel.sendCard(
      options.input.chatId,
      buildModelsCard({
        sessionKey: options.input.sessionKey,
        ...(current ? { current } : {}),
        models: modelEntries(host),
        sessionMode: sessionModeLabel(options.config, options.input),
      }),
      { replyTo: options.input.messageId },
    );
    return true;
  }

  // /status：发送状态卡片（连接、队列深度、模型、运行中）
  if (command.name === "status") {
    const model = host.runtime.session.model
      ? `${host.runtime.session.model.provider}/${host.runtime.session.model.id}`
      : undefined;
    await options.channel.sendCard(
      options.input.chatId,
      buildStatusCard({
        sessionKey: options.input.sessionKey,
        connected: options.channel.connected,
        queueDepth: host.queue.depth,
        active: host.activeRun !== undefined,
        ...(model ? { model } : {}),
        chatType: options.input.chatType,
        sessionMode: sessionModeLabel(options.config, options.input),
      }),
      { replyTo: options.input.messageId },
    );
    return true;
  }

  return false;
}

/**
 * 处理一条飞书消息（serve 主流程中每个消息事件都会调用）。
 *
 * 流程：
 * 1. routeConversation 路由：被拒绝则回复原因（未@机器人时静默忽略）
 * 2. 获取/创建会话宿主
 * 3. 处理附件（图片转 base64、文本内联、其他文件落盘）
 * 4. 归一化消息
 * 5. 若是命令走 handleCommand；否则入队生成
 *
 * 生成期间：先发送"正在处理"卡片（可点击停止），
 * 结束后把卡片更新为"完成/失败"。
 */
export async function handleFeishuMessage(options: {
  config: FeishuConfig;
  channel: FeishuChannel;
  store: FeishuStore;
  manager: SessionHostManager;
  message: FeishuMessage;
}): Promise<void> {
  // 1. 路由
  const route = routeConversation(options.config, options.message);
  if (!route.accepted) {
    // 未@机器人属于"静默忽略"，不打扰群聊；其他拒绝原因回复给用户
    if (route.reason !== "Bot was not mentioned") {
      await options.channel.sendText(options.message.chatId, route.reason, { replyTo: options.message.messageId });
    }
    return;
  }

  // 2. 获取会话宿主（按需创建 Pi 运行时）
  const host = await options.manager.getHost(route.sessionKey, route.identity);

  // 3. 处理附件（根据模型是否支持图片决定图片的处理方式）
  const attachments = await processAttachments({
    channel: options.channel,
    config: options.config,
    message: options.message,
    sessionKey: route.sessionKey,
    supportsImages: host.runtimeHost.supportsImages(),
  });

  // 4. 归一化消息
  const input = normalizeMessage({
    message: options.message,
    route,
    images: attachments.images,
    attachmentNotes: attachments.notes,
  });

  // 5a. 命令优先处理，处理完清理临时附件
  if (await handleCommand({ input, config: options.config, channel: options.channel, store: options.store, manager: options.manager })) {
    await cleanupTempAttachments(options.config.files.tempDir ?? ".", route.sessionKey).catch(() => {});
    return;
  }

  // 5b. 普通消息：入队生成（同一会话串行）
  await host.queue.enqueue(async () => {
    // 先发一张"正在处理"卡片（带停止按钮）
    const stopCard = await options.channel.sendCard(
      input.chatId,
      buildStopCard({
        sessionKey: input.sessionKey,
        chatType: input.chatType,
        ...(input.senderName ? { senderName: input.senderName } : {}),
        sessionMode: sessionModeLabel(options.config, input),
      }),
      { replyTo: input.messageId },
    );
    // 记录 activeRun，供 /stop 中止
    host.activeRun = {
      sessionKey: input.sessionKey,
      chatId: input.chatId,
      messageId: input.messageId,
      startedAt: new Date(),
      abort: async () => {
        await host.runtimeHost.abort();
      },
    };
    try {
      // 调用 Pi 会话生成（内部做流式渲染）
      await host.runtimeHost.prompt(input);
      // 完成后把卡片更新为"已完成"
      await options.channel.updateCard(stopCard.messageId, buildStopDoneCard("Pi 已完成", "回复已生成完成。"));
    } catch (error) {
      // 失败则把卡片更新为"失败"，并继续抛出（由上层记录错误）
      const message = error instanceof Error ? error.message : String(error);
      await options.channel.updateCard(stopCard.messageId, buildStopDoneCard("Pi 失败", message));
      throw error;
    } finally {
      delete host.activeRun;
      host.lastUsedAt = new Date();
    }
  });
}
