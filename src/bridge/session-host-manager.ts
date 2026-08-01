import type { FeishuChannel, FeishuConfig, FeishuIdentity, FeishuStore, SessionHost, SessionMapping } from "../types.js";
import { PromptQueue } from "./prompt-queue.js";
import { createRuntimeHost, type RuntimeHost } from "./runtime-host.js";

/** 被管理器管理的会话宿主：在 SessionHost 基础上增加 runtimeHost 和强类型 queue */
interface ManagedSessionHost extends SessionHost {
  runtimeHost: RuntimeHost;
  queue: PromptQueue;
}

/**
 * 会话宿主管理器：
 * 以 sessionKey 为维度，在内存中维护一组 Pi 运行时实例，
 * 并通过 FeishuStore 把"会话 key <-> 会话文件/工作目录"持久化到磁盘。
 *
 * 职责：
 * - getHost：按需创建/复用运行时（懒加载）
 * - newSession / switchToMapping / deleteMapping：会话生命周期管理
 * - abort：中止当前生成
 * - evictIdle：按 idleTtlMs 回收长时间不用的会话，释放内存
 */
export class SessionHostManager {
  private readonly hosts = new Map<string, ManagedSessionHost>();
  private readonly config: FeishuConfig;
  private readonly store: FeishuStore;
  private readonly channel: FeishuChannel;
  private idleEvictionTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: { config: FeishuConfig; store: FeishuStore; channel: FeishuChannel }) {
    this.config = options.config;
    this.store = options.store;
    this.channel = options.channel;
  }

  /**
   * 获取（或创建）某个会话 key 的宿主。
   * - 内存中已有：刷新 lastUsedAt 直接返回
   * - 没有：查存储恢复历史会话（cwd、sessionFile），否则新建，并持久化映射
   */
  async getHost(sessionKey: string, identity: FeishuIdentity): Promise<ManagedSessionHost> {
    const existing = this.hosts.get(sessionKey);
    if (existing) {
      existing.lastUsedAt = new Date();
      return existing;
    }

    const mapping = await this.store.getSessionMapping(sessionKey);
    const cwd = mapping?.cwd ?? this.config.sessions.defaultCwd ?? process.cwd();
    const runtimeHost = await createRuntimeHost({
      sessionKey,
      cwd,
      config: this.config,
      channel: this.channel,
      ...(mapping?.sessionFile ? { sessionFile: mapping.sessionFile } : {}),
    });
    const host: ManagedSessionHost = {
      sessionKey,
      runtime: runtimeHost.runtime,
      runtimeHost,
      queue: new PromptQueue(),
      lastUsedAt: new Date(),
    };
    this.hosts.set(sessionKey, host);
    await this.persistHost(host, identity);
    return host;
  }

  /** 只读查询内存中是否有该会话的宿主（不创建） */
  getActiveHost(sessionKey: string): ManagedSessionHost | undefined {
    return this.hosts.get(sessionKey);
  }

  /** 新建一个空会话（/new 命令），清空上下文并重新绑定扩展 */
  async newSession(sessionKey: string, identity: FeishuIdentity): Promise<void> {
    const host = await this.getHost(sessionKey, identity);
    await host.runtime.newSession();
    await host.runtime.session.bindExtensions({});
    await this.persistHost(host, identity);
  }

  /** 切换到另一个持久化的会话（/sessions 卡片上的"切换"按钮） */
  async switchToMapping(sessionKey: string, targetSessionKey: string, identity: FeishuIdentity): Promise<boolean> {
    const target = await this.store.getSessionMapping(targetSessionKey);
    if (!target) return false;
    const host = await this.getHost(sessionKey, identity);
    await host.runtime.switchSession(target.sessionFile, { cwdOverride: target.cwd });
    await host.runtime.session.bindExtensions({});
    await this.persistHost(host, identity);
    return true;
  }

  /** 中止当前生成（/stop 或卡片"停止生成"按钮）。没有活动会话时返回 false */
  async abort(sessionKey: string): Promise<boolean> {
    const host = this.hosts.get(sessionKey);
    if (!host) return false;
    await host.runtimeHost.abort();
    return true;
  }

  /** 启动空闲会话回收定时器。定时器只触发检查，是否回收由 idleTtlMs 决定。 */
  startIdleEviction(options: { intervalMs?: number; onError?: (error: Error) => void } = {}): void {
    this.stopIdleEviction();
    this.idleEvictionTimer = setInterval(() => {
      this.evictIdle().catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        options.onError?.(normalized);
      });
    }, options.intervalMs ?? 5 * 60 * 1000);
    this.idleEvictionTimer.unref();
  }

  /** 停止空闲会话回收定时器。 */
  stopIdleEviction(): void {
    if (!this.idleEvictionTimer) return;
    clearInterval(this.idleEvictionTimer);
    this.idleEvictionTimer = undefined;
  }

  /** 删除会话：先释放内存中的运行时，再删除持久化映射 */
  async deleteMapping(sessionKey: string): Promise<void> {
    const host = this.hosts.get(sessionKey);
    if (host) {
      await host.runtimeHost.dispose();
      this.hosts.delete(sessionKey);
    }
    await this.store.deleteSessionMapping(sessionKey);
  }

  /** 列出全部持久化的会话映射 */
  async listMappings(): Promise<SessionMapping[]> {
    return await this.store.listSessionMappings();
  }

  /**
   * 回收空闲会话：超过 idleTtlMs 未使用且当前没有生成任务的会话，
   * 释放运行时并移出内存（下次使用会从磁盘恢复）。
   */
  async evictIdle(now: Date = new Date()): Promise<void> {
    const expired: string[] = [];
    for (const [key, host] of this.hosts) {
      if (now.getTime() - host.lastUsedAt.getTime() > this.config.sessions.idleTtlMs && !host.activeRun) {
        expired.push(key);
      }
    }
    for (const key of expired) {
      const host = this.hosts.get(key);
      if (host) {
        await host.runtimeHost.dispose();
        this.hosts.delete(key);
      }
    }
  }

  /**
   * 把宿主的会话信息持久化到 FeishuStore：
   * 记录会话文件路径、工作目录、创建/更新时间，以及（私聊或 per-user 模式下）用户 id。
   */
  private async persistHost(host: ManagedSessionHost, identity: FeishuIdentity): Promise<void> {
    const sessionFile = host.runtime.session.sessionFile;
    if (!sessionFile) return;
    const now = new Date().toISOString();
    const previous = await this.store.getSessionMapping(host.sessionKey);
    await this.store.setSessionMapping({
      sessionKey: host.sessionKey,
      appId: this.config.appId,
      chatType: identity.chatType,
      chatId: identity.chatId,
      cwd: host.runtime.cwd,
      sessionFile,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      ...(identity.tenantKey ? { tenantKey: identity.tenantKey } : {}),
      ...(identity.chatType === "private" || this.config.sessions.groupScope === "per-user"
        ? { userId: identity.userOpenId }
        : {}),
    });
  }
}
