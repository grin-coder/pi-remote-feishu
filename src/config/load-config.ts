import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultUserConfigPath, mergeConfig, normalizeConfig, parsePartialConfig, type PartialFeishuConfig } from "./schema.js";
import type { FeishuConfig } from "../types.js";

/**
 * 配置加载入口。
 * 配置来源及优先级（低 -> 高）：
 *   环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET / ... < 配置文件 < CLI 参数
 */

/** loadConfig 的选项：可直接传部分配置字段覆盖，外加 configPath / cwd */
export interface LoadConfigOptions extends PartialFeishuConfig {
  configPath?: string;
  cwd?: string;
}

/** 读取并解析一个配置文件（JSON） */
function readConfigFile(path: string): PartialFeishuConfig {
  const raw = readFileSync(path, "utf-8");
  return parsePartialConfig(JSON.parse(raw));
}

/**
 * 定位配置文件：
 * - 显式指定 configPath 时用显式路径
 * - 否则优先找项目级 .pi/feishu.json，其次用户级 ~/.pi/agent/feishu.json
 * - 都没有则返回 undefined（只用环境变量 + CLI 参数）
 */
function findConfigFile(cwd: string, explicitPath?: string): string | undefined {
  if (explicitPath) return resolve(explicitPath);
  const projectPath = join(cwd, ".pi", "feishu.json");
  if (existsSync(projectPath)) return projectPath;
  const userPath = defaultUserConfigPath();
  if (existsSync(userPath)) return userPath;
  return undefined;
}

/** 对外暴露"配置文件在哪儿"，供 doctor 命令展示 */
export function resolveConfigFilePath(cwd: string, explicitPath?: string): string | undefined {
  return findConfigFile(resolve(cwd), explicitPath);
}

/** 从环境变量读取配置（FEISHU_APP_ID 等） */
function envConfig(): PartialFeishuConfig {
  return parsePartialConfig({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    botName: process.env.FEISHU_BOT_NAME,
    encryptKey: process.env.FEISHU_ENCRYPT_KEY,
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
  });
}

/**
 * 加载并归一化完整配置。
 * 合并顺序：envConfig（最低）-> fileConfig -> cliConfig（最高）。
 */
export function loadConfig(options: LoadConfigOptions = {}): FeishuConfig {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = findConfigFile(cwd, options.configPath);
  const fileConfig = configPath ? readConfigFile(configPath) : {};
  const cliConfig = parsePartialConfig(options);

  return normalizeConfig(mergeConfig(envConfig(), fileConfig, cliConfig), cwd);
}
