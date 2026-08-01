#!/usr/bin/env node
/**
 * ============================================================
 * pi-remote-feishu 命令行入口（bin）
 * ------------------------------------------------------------
 * 支持子命令：
 *   serve      启动 WebSocket 桥接，把飞书消息转发给 Pi 运行时（主命令）
 *   init       生成一份 feishu.json 配置模板
 *   doctor     检查配置与飞书 WebSocket 连通性
 *   send-test  向指定聊天发送一条测试消息
 *   help       打印帮助
 *
 * 参数来源优先级：环境变量 < 配置文件 < CLI 参数（见 config/load-config.ts）
 * ============================================================
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { handleCardAction } from "../bridge/card-actions.js";
import { handleFeishuMessage } from "../bridge/message-handler.js";
import { SessionHostManager } from "../bridge/session-host-manager.js";
import { loadConfig, resolveConfigFilePath, type LoadConfigOptions } from "../config/load-config.js";
import { createFeishuChannel } from "../feishu/channel.js";
import { createWebhookNotImplementedError } from "../feishu/webhook.js";
import { createStore } from "../store/store.js";
import type { FeishuCardAction, FeishuConfig, FeishuMessage } from "../types.js";

/** 飞书 WebSocket 连接/断开的超时时间（毫秒） */
const CONNECT_TIMEOUT_MS = 20_000;
const DISCONNECT_TIMEOUT_MS = 5_000;

/** CLI 解析后的选项 */
interface CliOptions {
  command: "serve" | "init" | "doctor" | "send-test" | "help";
  /** 传给 loadConfig 的配置覆盖项（appId、appSecret、configPath、cwd 等） */
  config: LoadConfigOptions;
  logLevel?: string;
  /** init 时配置文件输出路径 */
  initPath?: string;
  /** init 时是否允许覆盖已有文件 */
  force?: boolean;
  /** send-test 目标聊天 id */
  chatId?: string;
  /** send-test 发送的文本 */
  text?: string;
}

/** 读取某个 flag 后面的参数值，缺失则报错 */
function readFlag(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${args[index]}`);
  }
  return value;
}

/**
 * 解析命令行参数。
 * 第一个参数如果是 serve/init/doctor/send-test/help 则作为子命令，
 * 否则默认为 serve（方便直接运行 `pi-remote-feishu --app-id ...`）。
 */
function parseArgs(args: string[]): CliOptions {
  const command =
    args[0] === "serve" || args[0] === "init" || args[0] === "doctor" || args[0] === "send-test"
      ? args[0]
      : args[0] === "help" || args[0] === "--help" || args[0] === "-h"
        ? "help"
        : "serve";
  const config: LoadConfigOptions = {};
  let logLevel: string | undefined;
  let initPath: string | undefined;
  let force = false;
  let chatId: string | undefined;
  let text: string | undefined;

  for (let index = command === "serve" || command === "init" || command === "doctor" || command === "send-test" ? 1 : 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--app-id") {
      config.appId = readFlag(args, index);
      index += 1;
    } else if (arg === "--app-secret") {
      config.appSecret = readFlag(args, index);
      index += 1;
    } else if (arg === "--config") {
      config.configPath = readFlag(args, index);
      initPath = resolve(config.configPath);
      index += 1;
    } else if (arg === "--cwd") {
      config.cwd = resolve(readFlag(args, index));
      index += 1;
    } else if (arg === "--log-level") {
      logLevel = readFlag(args, index);
      index += 1;
    } else if (arg === "--group-scope") {
      // 群聊会话隔离范围：shared-chat（共享）/ per-user（按用户隔离）
      const groupScope = readFlag(args, index);
      if (groupScope !== "shared-chat" && groupScope !== "per-user") {
        throw new Error("--group-scope must be shared-chat or per-user");
      }
      config.sessions = { ...config.sessions, groupScope };
      index += 1;
    } else if (arg === "--debug-events") {
      // 打印收到的消息/卡片事件摘要
      config.debug = { ...config.debug, logIncomingEvents: true };
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--chat-id") {
      chatId = readFlag(args, index);
      index += 1;
    } else if (arg === "--text") {
      text = readFlag(args, index);
      index += 1;
    }
  }

  return {
    command,
    config,
    ...(logLevel ? { logLevel } : {}),
    ...(initPath ? { initPath } : {}),
    ...(force ? { force } : {}),
    ...(chatId ? { chatId } : {}),
    ...(text ? { text } : {}),
  };
}

/** 打印命令行帮助 */
function printHelp(): void {
  console.log(`Usage:
  pi-remote-feishu serve [options]
  pi-remote-feishu init [--config <path>] [--force]
  pi-remote-feishu doctor [options]
  pi-remote-feishu send-test --chat-id <chatId> --text <text> [options]

Options:
  --app-id <id>          Feishu app id
  --app-secret <secret>  Feishu app secret
  --config <path>        Config file path
  --cwd <path>           Default Pi working directory
  --log-level <level>    fatal|error|warn|info|debug|trace
  --group-scope <scope>  shared-chat|per-user
  --debug-events         Log incoming message/card action summaries
  --force                Overwrite config when used with init
  --chat-id <id>         Target chat id for send-test
  --text <text>          Text for send-test
`);
}

/** 脱敏 App Secret：只保留头尾各 4 位，中间用 **** 代替 */
function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 给 Promise 加超时：超时后 reject，并在结束时清理定时器 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** 生成一份默认配置模板（pi-remote-feishu init 用），已存在且未带 --force 时拒绝覆盖 */
function writeConfigTemplate(path: string, force: boolean): void {
  if (existsSync(path) && !force) {
    throw new Error(`Config already exists: ${path}. Use --force to overwrite.`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const template = {
    appId: "cli_xxx",
    appSecret: "replace-with-app-secret",
    botName: "Pi Agent",
    transport: "websocket",
    policy: {
      requireMention: true,
      dmEnabled: true,
      groupEnabled: true,
      allowUsers: [],
      allowChats: [],
    },
    sessions: {
      groupScope: "shared-chat",
      defaultCwd: process.cwd(),
      store: "json",
      idleTtlMs: 1_800_000,
    },
    rendering: {
      mode: "stream-card",
      showThinking: "quote",
      showToolEvents: true,
    },
    files: {
      allowedOutputDirs: [process.cwd()],
      maxUploadBytes: 20_971_520,
    },
    debug: {
      logIncomingEvents: false,
    },
  };
  writeFileSync(path, `${JSON.stringify(template, null, 2)}\n`, "utf-8");
}

/** 生成收到的消息摘要（--debug-events 时打印到 stderr） */
function incomingMessageSummary(message: FeishuMessage): string {
  return JSON.stringify({
    event: "message",
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    userOpenId: message.userOpenId,
    senderName: message.senderName ?? "",
    mentionedBot: message.mentionedBot,
    textLength: message.text.length,
    resources: message.resources.length,
  });
}

/** 生成收到的卡片事件摘要（--debug-events 时打印到 stderr） */
function incomingCardActionSummary(event: FeishuCardAction): string {
  return JSON.stringify({
    event: "cardAction",
    messageId: event.messageId ?? "",
    chatId: event.chatId,
    userOpenId: event.userOpenId ?? "",
    cmd: typeof event.actionValue.cmd === "string" ? event.actionValue.cmd : "",
    hasToken: event.token !== undefined,
  });
}

/** 根据配置创建飞书通道 */
function createChannel(config: FeishuConfig, logLevel: string | undefined) {
  return createFeishuChannel({
    appId: config.appId,
    appSecret: config.appSecret,
    requireMention: config.policy.requireMention,
    ...(logLevel ? { logLevel } : {}),
  });
}

/** doctor 子命令：打印配置摘要，并实际连一次飞书 WebSocket 验证连通性 */
async function runDoctor(cli: CliOptions): Promise<void> {
  const cwd = resolve(cli.config.cwd ?? process.cwd());
  const configPath = resolveConfigFilePath(cwd, cli.config.configPath);
  const config = loadConfig(cli.config);

  console.log("Pi Feishu Doctor");
  console.log(`- cwd: ${cwd}`);
  console.log(`- config: ${configPath ?? "env/cli only"}`);
  console.log(`- appId: ${config.appId}`);
  console.log(`- appSecret: ${maskSecret(config.appSecret)}`);
  console.log(`- transport: ${config.transport}`);
  console.log(`- dmEnabled: ${config.policy.dmEnabled}`);
  console.log(`- groupEnabled: ${config.policy.groupEnabled}`);
  console.log(`- requireMention: ${config.policy.requireMention}`);
  console.log(`- groupScope: ${config.sessions.groupScope}`);
  console.log(`- debug.logIncomingEvents: ${config.debug.logIncomingEvents}`);

  if (config.transport === "webhook") {
    console.log("- websocket: skipped, webhook transport is not implemented in v1");
    return;
  }

  const channel = createChannel(config, cli.logLevel);
  try {
    await withTimeout(channel.connect(), CONNECT_TIMEOUT_MS, "Feishu websocket connect");
    console.log(`- websocket: connected${channel.botName ? ` as ${channel.botName}` : ""}`);
  } finally {
    await withTimeout(channel.disconnect(), DISCONNECT_TIMEOUT_MS, "Feishu websocket disconnect").catch(() => {});
  }
}

/** send-test 子命令：连接飞书并发送一条测试文本 */
async function runSendTest(cli: CliOptions): Promise<void> {
  if (!cli.chatId) {
    throw new Error("Missing --chat-id");
  }
  if (!cli.text) {
    throw new Error("Missing --text");
  }
  const config = loadConfig(cli.config);
  if (config.transport === "webhook") {
    throw createWebhookNotImplementedError();
  }
  const channel = createChannel(config, cli.logLevel);
  try {
    await withTimeout(channel.connect(), CONNECT_TIMEOUT_MS, "Feishu websocket connect");
    const result = await channel.sendText(cli.chatId, cli.text);
    console.log(`Sent test message: ${result.messageId}`);
  } finally {
    await withTimeout(channel.disconnect(), DISCONNECT_TIMEOUT_MS, "Feishu websocket disconnect").catch(() => {});
  }
}

/**
 * serve 主流程：
 * 1. 加载配置、创建通道和存储
 * 2. 创建 SessionHostManager（负责按 sessionKey 管理 Pi 运行时）
 * 3. 注册消息/卡片/错误三个回调
 * 4. 连接飞书，阻塞直到收到 SIGINT/SIGTERM
 */
async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.command === "help") {
    printHelp();
    return;
  }

  if (cli.command === "init") {
    const cwd = resolve(cli.config.cwd ?? process.cwd());
    const configPath = cli.initPath ?? join(cwd, ".pi", "feishu.json");
    writeConfigTemplate(configPath, cli.force ?? false);
    console.log(`Created Feishu config: ${configPath}`);
    return;
  }

  if (cli.command === "doctor") {
    await runDoctor(cli);
    process.exit(0);
  }

  if (cli.command === "send-test") {
    await runSendTest(cli);
    process.exit(0);
  }

  // ---- serve 子命令 ----
  const config = loadConfig(cli.config);
  if (config.transport === "webhook") {
    throw createWebhookNotImplementedError();
  }

  const channel = createChannel(config, cli.logLevel);
  const store = createStore(config);
  const manager = new SessionHostManager({ config, store, channel });

  // 收到飞书消息：可选的调试摘要 -> 交给 handleFeishuMessage 处理
  channel.onMessage((message) => {
    if (config.debug.logIncomingEvents) {
      console.error(incomingMessageSummary(message));
    }
    handleFeishuMessage({ config, channel, store, manager, message }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
  });
  // 收到卡片按钮事件：交给 handleCardAction 处理
  channel.onCardAction((event) => {
    if (config.debug.logIncomingEvents) {
      console.error(incomingCardActionSummary(event));
    }
    handleCardAction({
      config,
      store,
      manager,
      event,
      updateCardByToken: async (token, card) => {
        await channel.updateCardByToken(token, card);
      },
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
  });
  channel.onError((error) => {
    console.error(error.message);
  });

  await channel.connect();
  manager.startIdleEviction({
    onError: (error) => {
      console.error(error.message);
    },
  });
  console.error(`Feishu bot connected${channel.botName ? ` as ${channel.botName}` : ""}.`);

  // 阻塞等待退出信号，收到后断开飞书连接
  await new Promise<void>((resolvePromise) => {
    const shutdown = () => {
      manager.stopIdleEviction();
      manager.evictIdle().finally(() => {
        channel.disconnect().finally(resolvePromise);
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
