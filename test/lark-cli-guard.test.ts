import { describe, expect, it } from "vitest";
import { isBlockedLarkImCommand, isLarkCliInstalled } from "../src/extensions/lark-cli-guard.js";

/**
 * lark-cli 护栏测试：
 * 验证 IM 写/收命令被拦截，文档/只读命令放行。
 */
describe("lark cli guard", () => {
  it("blocks lark im send and reply commands", () => {
    // 发送 / 回复消息应被拦截（+xxx 前缀写法）
    expect(isBlockedLarkImCommand("lark-cli im +messages-send --chat-id oc_xxx --text hi")).toBe(true);
    expect(isBlockedLarkImCommand("npx lark-cli im +messages-reply --message-id om_xxx --text hi")).toBe(true);
  });

  it("allows lark doc and readonly im commands", () => {
    // 文档操作、只读 IM 查询应放行
    expect(isBlockedLarkImCommand("lark-cli docs +fetch --doc https://example.com/doc")).toBe(false);
    expect(isBlockedLarkImCommand("lark-cli im +chat-members-list --chat-id oc_xxx")).toBe(false);
    expect(isBlockedLarkImCommand("lark-cli im +messages-resources-download --message-id om_xxx --file-key f --type file")).toBe(false);
  });

  it("returns a boolean for local lark-cli availability", () => {
    // 本机 lark-cli 是否安装应返回布尔值
    expect(typeof isLarkCliInstalled()).toBe("boolean");
  });
});
