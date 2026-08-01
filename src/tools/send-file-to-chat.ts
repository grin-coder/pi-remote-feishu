import { stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getFeishuContext } from "../feishu/context.js";
import type { FeishuConfig } from "../types.js";

/**
 * ============================================================
 * send_file_to_chat 工具
 * ------------------------------------------------------------
 * 供 Pi 在生成过程中调用：把本地生成的文件回传到当前飞书聊天。
 *
 * 安全校验：
 * - 必须在飞书请求上下文内（getFeishuContext）才可用
 * - 文件路径必须在 allowedOutputDirs 白名单内
 * - 必须是文件且大小不超过 maxUploadBytes
 * ============================================================
 */

/** 工具参数 schema（typebox 描述，Pi 会据此生成函数签名给模型看） */
const sendFileSchema = Type.Object({
  filePath: Type.String({ description: "Local file path to send to the current Feishu chat" }),
  fileName: Type.Optional(Type.String({ description: "Display file name in Feishu" })),
});

/** 判断 target 是否在 root 目录之内（含 root 本身），防止路径穿越 */
function isUnderPath(target: string, root: string): boolean {
  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(root);
  const relativePath = relative(resolvedRoot, resolvedTarget);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

/** 校验文件：目录白名单 + 是文件 + 大小上限，通过则返回绝对路径 */
async function validateFile(filePath: string, config: FeishuConfig): Promise<string> {
  const resolvedPath = resolve(filePath);
  if (!config.files.allowedOutputDirs.some((dir) => isUnderPath(resolvedPath, dir))) {
    throw new Error("File is outside allowed output directories");
  }
  const statResult = await stat(resolvedPath);
  if (!statResult.isFile()) {
    throw new Error("Path is not a file");
  }
  if (statResult.size > config.files.maxUploadBytes) {
    throw new Error(`File exceeds upload limit (${config.files.maxUploadBytes} bytes)`);
  }
  return resolvedPath;
}

/**
 * 创建 send_file_to_chat 工具。
 * 在 Pi 的运行时中注册后，模型生成完文件即可调用它把文件发回飞书。
 */
export function createSendFileToChatTool(config: FeishuConfig): ToolDefinition<typeof sendFileSchema, undefined> {
  return {
    name: "send_file_to_chat",
    label: "Send file to Feishu chat",
    description: "Send a local file to the current Feishu chat. Only works while handling a Feishu request.",
    promptGuidelines: [
      "When you create a deliverable file for a Feishu user, call send_file_to_chat with the final local file path.",
      "Only send files that already exist and are relevant to the user's request.",
    ],
    parameters: sendFileSchema,
    async execute(_toolCallId, params) {
      // 只能在飞书请求上下文中使用（运行时通过 AsyncLocalStorage 注入）
      const context = getFeishuContext();
      if (!context) {
        return {
          content: [{ type: "text", text: "Not currently handling a Feishu request; cannot send file." }],
          details: undefined,
        };
      }

      try {
        const filePath = await validateFile(params.filePath, config);
        await context.channel.sendFile(context.chatId, filePath, params.fileName ?? basename(filePath));
        return {
          content: [{ type: "text", text: `Sent file to Feishu: ${params.fileName ?? basename(filePath)}` }],
          details: undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to send file to Feishu: ${message}` }],
          details: undefined,
        };
      }
    },
  };
}
