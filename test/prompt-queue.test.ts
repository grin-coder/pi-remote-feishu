import { describe, expect, it } from "vitest";
import { PromptQueue } from "../src/bridge/prompt-queue.js";

/**
 * 提示词队列测试：
 * 验证同一队列内任务严格串行、不同队列相互独立。
 */
describe("PromptQueue", () => {
  it("serializes jobs in one queue", async () => {
    const queue = new PromptQueue();
    const order: string[] = [];

    // 第一个任务耗时 20ms，第二个任务应立即排队等待
    const first = queue.enqueue(async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first-end");
    });
    const second = queue.enqueue(async () => {
      order.push("second-start");
      order.push("second-end");
    });

    await Promise.all([first, second]);

    // 顺序必须是 first 全部完成后再 second
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  it("allows different queues to run independently", async () => {
    const a = new PromptQueue();
    const b = new PromptQueue();
    const order: string[] = [];

    // 不同队列之间互不阻塞
    await Promise.all([
      a.enqueue(async () => {
        order.push("a-start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("a-end");
      }),
      b.enqueue(async () => {
        order.push("b-start");
        order.push("b-end");
      }),
    ]);

    expect(order.indexOf("b-start")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end"));
  });
});
