import type { FeishuChannel, FeishuConfig, StreamWriter } from "../types.js";

/**
 * ============================================================
 * 流式渲染器
 * ------------------------------------------------------------
 * 把 Pi 会话运行过程中产生的事件流（文本增量、思考、工具调用、
 * 压缩、自动重试等）实时转发成飞书流式 Markdown 消息。
 *
 * 支持三种渲染模式（config.rendering.mode）：
 * - stream-card：默认。通过 channel.streamMarkdown 流式输出
 * - text：不渲染任何事件，只跑 prompt（静默执行）
 * ============================================================
 */

/** 助手消息事件（来自 Pi session 的事件流） */
interface AssistantMessageEvent {
  type: string;
  delta?: string;
  error?: unknown;
}

/** 运行时事件（Pi session 订阅到的事件） */
interface RuntimeEvent {
  type: string;
  assistantMessageEvent?: AssistantMessageEvent;
  toolName?: string;
  partialResult?: unknown;
  isError?: boolean;
  attempt?: number;
  maxAttempts?: number;
  success?: boolean;
}

/** 可订阅会话接口：Pi 的 session 满足此结构 */
export interface SubscribableSession {
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
}

export interface StreamRenderOptions {
  config: FeishuConfig;
  channel: FeishuChannel;
  chatId: string;
  replyTo?: string;
  session: SubscribableSession;
  runPrompt(): Promise<void>;
}

/**
 * 订阅会话事件并把它们翻译成流式文本。
 * 返回取消订阅函数。
 *
 * 细节：
 * - 文本增量（text_delta）直接追加
 * - 思考增量（thinking_delta）按 showThinking 配置处理：
 *   hide 丢弃 / plain 原文输出 / quote 逐字符加 "> " 前缀（形成引用块）
 * - 工具调用、压缩、重试等事件在 showToolEvents 开启时输出提示文字
 */
function createSessionEventForwarder(session: SubscribableSession, writer: StreamWriter, config: FeishuConfig): () => void {
  /** 是否正处于思考块内（用于在切回正文时补换行） */
  let inThinking = false;
  /** 下一行是否需要在行首加 "> " 前缀 */
  let needsQuotePrefix = true;

  /** 结束思考块：返回补上的分隔空行 */
  function closeThinking(): string {
    if (!inThinking) return "";
    inThinking = false;
    needsQuotePrefix = true;
    return "\n\n";
  }

  return session.subscribe((event) => {
    // ---- 助手消息相关事件 ----
    if (event.type === "message_update") {
      const messageEvent = event.assistantMessageEvent;
      if (!messageEvent) return;
      if (messageEvent.type === "text_delta") {
        // 正文增量：先关闭思考块再追加
        void writer.append(closeThinking() + (messageEvent.delta ?? ""));
      } else if (messageEvent.type === "thinking_delta" && config.rendering.showThinking !== "hide") {
        const delta = messageEvent.delta ?? "";
        if (config.rendering.showThinking === "plain") {
          // 原文模式：直接输出思考内容
          void writer.append(delta);
          return;
        }
        // quote 模式：逐字符处理换行，保证每行都有 "> " 前缀（Markdown 引用块）
        let output = "";
        for (const character of delta) {
          if (needsQuotePrefix) {
            output += "> ";
            needsQuotePrefix = false;
          }
          output += character;
          if (character === "\n") {
            needsQuotePrefix = true;
          }
        }
        inThinking = true;
        void writer.append(output);
      } else if (messageEvent.type === "error") {
        void writer.append(`${closeThinking()}Model returned an error.`);
      }
      return;
    }

    // ---- 工具/系统事件：仅在 showToolEvents 开启时输出 ----
    if (!config.rendering.showToolEvents) return;

    if (event.type === "tool_execution_start") {
      void writer.append(`${closeThinking()}\nRunning tool: ${event.toolName ?? "unknown"}\n`);
    } else if (event.type === "tool_execution_update") {
      void writer.append(`${closeThinking()}${String(event.partialResult ?? "")}`);
    } else if (event.type === "tool_execution_end") {
      void writer.append(`${closeThinking()}${event.isError ? "Tool failed" : "Tool completed"}\n`);
    } else if (event.type === "compaction_start") {
      void writer.append(`${closeThinking()}Compacting context...\n`);
    } else if (event.type === "compaction_end") {
      void writer.append(`${closeThinking()}Compaction complete.\n`);
    } else if (event.type === "auto_retry_start") {
      void writer.append(`${closeThinking()}Retrying (${event.attempt ?? "?"}/${event.maxAttempts ?? "?"})...\n`);
    } else if (event.type === "auto_retry_end") {
      void writer.append(`${closeThinking()}${event.success ? "Retry succeeded" : "Retry failed"}\n`);
    }
  });
}

/**
 * 运行一次 prompt 并渲染输出：
 * - mode 为 text 时静默执行，不渲染
 * - 其他模式通过 channel.streamMarkdown 创建流式消息，期间把会话事件
 *   转发给 writer，消息发送完成后 Pi 侧会自动结束流
 */
export async function renderPromptStream(options: StreamRenderOptions): Promise<void> {
  if (options.config.rendering.mode === "text") {
    await options.runPrompt();
    return;
  }

  await options.channel.streamMarkdown(
    options.chatId,
    async (writer) => {
      const unsubscribe = createSessionEventForwarder(options.session, writer, options.config);
      try {
        await options.runPrompt();
      } finally {
        unsubscribe();
      }
    },
    options.replyTo ? { replyTo: options.replyTo } : undefined,
  );
}
