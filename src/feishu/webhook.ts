/**
 * Webhook 传输模式在 v1 版本尚未实现。
 * 统一从这里抛出错误，避免各处硬编码相同的报错信息。
 */
export function createWebhookNotImplementedError(): Error {
  return new Error("Feishu webhook transport is not implemented yet; use websocket transport.");
}
