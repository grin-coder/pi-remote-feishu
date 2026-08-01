import { AsyncLocalStorage } from "node:async_hooks";
import type { FeishuRunContext } from "../types.js";

/**
 * 飞书运行上下文存储：
 * 使用 AsyncLocalStorage 在"一次飞书请求 -> Pi 生成"的整个异步调用链中
 * 传递 FeishuRunContext（channel、chatId、sessionKey、config 等）。
 *
 * 这样 send_file_to_chat、ui.select 等能力可以在任意深度拿到
 * 当前请求对应的飞书通道，而不必手动层层传参。
 */
const storage = new AsyncLocalStorage<FeishuRunContext>();

/** 读取当前调用链中的飞书上下文；不在飞书请求中则返回 undefined */
export function getFeishuContext(): FeishuRunContext | undefined {
  return storage.getStore();
}

/** 在指定上下文里执行 run()，整个 run 及其子异步调用都能读到该上下文 */
export async function runWithFeishuContext<T>(context: FeishuRunContext, run: () => Promise<T>): Promise<T> {
  return await storage.run(context, run);
}
