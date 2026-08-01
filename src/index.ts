/**
 * 公共入口：对外导出所有可供外部复用的 API。
 * 当其他项目以 npm 包方式引入 pi-remote-feishu 时，从这里 import。
 */

/** 卡片事件处理（stop 停止、model 切换模型、session 会话管理等） */
export { handleCardAction } from "./bridge/card-actions.js";
/** 会话路由：判断消息是否被接受，并计算 sessionKey */
export { routeConversation, buildSessionKey } from "./bridge/conversation-router.js";
/** 飞书消息总入口：路由 -> 附件处理 -> 归一化 -> 命令/生成 */
export { handleFeishuMessage } from "./bridge/message-handler.js";
/** 把飞书消息归一化成给 Pi 的输入（含群聊上下文、附件说明） */
export { normalizeMessage } from "./bridge/message-normalizer.js";
/** 提示词队列：保证同一会话的消息串行处理 */
export { PromptQueue } from "./bridge/prompt-queue.js";
/** 会话宿主管理器：按 sessionKey 管理 Pi 运行时实例 */
export { SessionHostManager } from "./bridge/session-host-manager.js";
/** 飞书 UI 桥接：把 Pi 的 ui.select/confirm 转成飞书权限卡片 */
export { createFeishuUIContext, resolvePermissionCardAction } from "./bridge/ui-context.js";
/** 配置加载：合并 环境变量 + 配置文件 + CLI 参数 */
export { loadConfig } from "./config/load-config.js";
/** 创建飞书通道（封装飞书 WebSocket SDK） */
export { createFeishuChannel } from "./feishu/channel.js";
/** 飞书运行上下文（AsyncLocalStorage 存取） */
export { getFeishuContext, runWithFeishuContext } from "./feishu/context.js";
/** JSON 文件存储：会话映射持久化 */
export { JsonFeishuStore } from "./store/json-store.js";
/** 生成 send_file_to_chat 工具，让 Pi 可以把本地文件回传到当前飞书聊天 */
export { createSendFileToChatTool } from "./tools/send-file-to-chat.js";
/** 导出全部公共类型 */
export type * from "./types.js";
