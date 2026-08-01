import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";

/**
 * 配置加载测试：验证三层配置的合并优先级（环境变量 < 配置文件 < CLI 参数）
 * 以及默认值填充。
 */
describe("loadConfig", () => {
  let tempDir: string;
  let previousAppId: string | undefined;
  let previousAppSecret: string | undefined;

  beforeEach(() => {
    // 每个用例使用独立临时目录，并清空相关环境变量
    tempDir = join(tmpdir(), `pi-remote-feishu-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    previousAppId = process.env.FEISHU_APP_ID;
    previousAppSecret = process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  });

  afterEach(() => {
    // 清理临时目录并恢复环境变量
    rmSync(tempDir, { recursive: true, force: true });
    if (previousAppId === undefined) {
      delete process.env.FEISHU_APP_ID;
    } else {
      process.env.FEISHU_APP_ID = previousAppId;
    }
    if (previousAppSecret === undefined) {
      delete process.env.FEISHU_APP_SECRET;
    } else {
      process.env.FEISHU_APP_SECRET = previousAppSecret;
    }
  });

  it("uses CLI config over file and env", () => {
    // 三层都提供 appId/appSecret，CLI 参数应胜出
    process.env.FEISHU_APP_ID = "env-id";
    process.env.FEISHU_APP_SECRET = "env-secret";
    const configPath = join(tempDir, "feishu.json");
    writeFileSync(configPath, JSON.stringify({ appId: "file-id", appSecret: "file-secret" }));

    const config = loadConfig({
      cwd: tempDir,
      configPath,
      appId: "cli-id",
      appSecret: "cli-secret",
    });

    expect(config.appId).toBe("cli-id");
    expect(config.appSecret).toBe("cli-secret");
  });

  it("loads defaults for private and group chat policy", () => {
    // 只给必填项，其余字段应填充默认值
    const config = loadConfig({ cwd: tempDir, appId: "id", appSecret: "secret" });

    expect(config.policy.dmEnabled).toBe(true);
    expect(config.policy.groupEnabled).toBe(true);
    expect(config.policy.requireMention).toBe(true);
    expect(config.sessions.groupScope).toBe("shared-chat");
    expect(config.sessions.store).toBe("json");
    expect(config.debug.logIncomingEvents).toBe(false);
  });

  it("loads debug incoming event logging", () => {
    // 配置文件里的 debug 开关应被读取
    const configPath = join(tempDir, "feishu.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        appId: "id",
        appSecret: "secret",
        debug: { logIncomingEvents: true },
      }),
    );

    const config = loadConfig({ cwd: tempDir, configPath });

    expect(config.debug.logIncomingEvents).toBe(true);
  });
});
