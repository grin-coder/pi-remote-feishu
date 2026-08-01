import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { cleanupTempAttachments } from "../attachments/temp-files.js";
import { createFeishuUIContext } from "./ui-context.js";
import { runWithFeishuContext } from "../feishu/context.js";
import { createSendFileToChatTool } from "../tools/send-file-to-chat.js";
import type { FeishuChannel, FeishuConfig, NormalizedPiInput } from "../types.js";
import { renderPromptStream } from "./stream-renderer.js";

/**
 * 运行时宿主：把一个 Pi 的 AgentSessionRuntime 与飞书通道绑定，
 * 并提供 prompt（生成）、abort（中止）、dispose（释放）等操作。
 *
 * 每次 prompt：
 * 1. 注入飞书 UI 上下文（让 ui.select 变成飞书权限卡片）
 * 2. 在 AsyncLocalStorage 里挂载 FeishuRunContext（供 send_file_to_chat 等工具读取）
 * 3. 通过 renderPromptStream 以流式卡片方式渲染回复
 * 4. 结束后清理临时附件、恢复之前的 UI 上下文
 */
export class RuntimeHost {
  readonly sessionKey: string;
  readonly runtime: AgentSessionRuntime;
  private readonly config: FeishuConfig;
  private readonly channel: FeishuChannel;

  constructor(options: {
    sessionKey: string;
    runtime: AgentSessionRuntime;
    config: FeishuConfig;
    channel: FeishuChannel;
  }) {
    this.sessionKey = options.sessionKey;
    this.runtime = options.runtime;
    this.config = options.config;
    this.channel = options.channel;
  }

  /** 当前模型是否支持图片输入（决定附件图片是转为 base64 还是落盘） */
  supportsImages(): boolean {
    return this.runtime.session.model?.input?.includes("image") ?? false;
  }

  /** 把一条归一化消息送入 Pi 会话生成，并以流式方式渲染到飞书 */
  async prompt(input: NormalizedPiInput): Promise<void> {
    // 注入飞书 UI 上下文：Pi 的 ui.select/confirm 会转化为飞书卡片
    const uiContext = createFeishuUIContext();
    const previousUIContext = this.runtime.session.extensionRunner.getUIContext();
    this.runtime.session.extensionRunner.setUIContext(uiContext, "rpc");

    try {
      // 挂载运行上下文，让 send_file_to_chat 等工具能拿到 channel/chatId
      await runWithFeishuContext(
        {
          sessionKey: this.sessionKey,
          chatId: input.chatId,
          messageId: input.messageId,
          channel: this.channel,
          uiContext,
          config: this.config,
        },
        async () => {
          await renderPromptStream({
            config: this.config,
            channel: this.channel,
            chatId: input.chatId,
            replyTo: input.messageId,
            session: this.runtime.session,
            runPrompt: async () => {
              await this.runtime.session.prompt(input.text, {
                // steer：把模型回复内容交给事件订阅器，由我们决定如何渲染
                streamingBehavior: "steer",
                ...(input.images.length > 0 ? { images: input.images } : {}),
              });
            },
          });
        },
      );
    } finally {
      // 恢复之前的 UI 上下文（tui 模式），并清理本会话的临时附件
      this.runtime.session.extensionRunner.setUIContext(previousUIContext, "tui");
      await cleanupTempAttachments(this.config.files.tempDir ?? ".", this.sessionKey).catch(() => {});
    }
  }

  /** 中止当前生成（/stop 或卡片上的"停止生成"按钮） */
  async abort(): Promise<void> {
    await this.runtime.session.abort();
  }

  /** 释放运行时资源（会话被回收/删除时调用） */
  async dispose(): Promise<void> {
    await this.runtime.dispose();
  }
}

/**
 * 创建一个新的运行时宿主：
 * - 有历史会话文件（sessionFile）则用 SessionManager.open 恢复
 * - 否则用 SessionManager.create 新建
 * - 注册 pi-remote-feishu-runtime 隐藏扩展，注入 send_file_to_chat 工具
 */
export async function createRuntimeHost(options: {
  sessionKey: string;
  sessionFile?: string;
  cwd: string;
  config: FeishuConfig;
  channel: FeishuChannel;
}): Promise<RuntimeHost> {
  const cwd = resolve(options.cwd);
  const agentDir = getAgentDir();
  const sessionManager =
    options.sessionFile && existsSync(options.sessionFile)
      ? SessionManager.open(options.sessionFile, undefined, cwd)
      : SessionManager.create(cwd);

  // 扩展工厂：为每个 Pi 会话注册 send_file_to_chat 工具
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    agentDir: runtimeAgentDir,
    sessionManager: runtimeSessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      agentDir: runtimeAgentDir,
      resourceLoaderOptions: {
        extensionFactories: [
          {
            name: "pi-remote-feishu-runtime",
            hidden: true,
            factory(pi) {
              pi.registerTool(createSendFileToChatTool(options.config));
            },
          },
        ],
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager: runtimeSessionManager,
        ...(sessionStartEvent ? { sessionStartEvent } : {}),
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager,
  });
  await runtime.session.bindExtensions({});

  return new RuntimeHost({
    sessionKey: options.sessionKey,
    runtime,
    config: options.config,
    channel: options.channel,
  });
}
