import type { FeishuChannel, FeishuConfig, FeishuMessage, ImageInput } from "../types.js";
import { inferMimeType, isLikelyText } from "./mime.js";
import { writeTempAttachment } from "./temp-files.js";

/**
 * ============================================================
 * 附件处理
 * ------------------------------------------------------------
 * 对消息携带的附件资源分类处理：
 * 1. 表情包(sticker)：直接跳过
 * 2. 图片 + 模型支持图片输入：转 base64 图片传给 Pi
 * 3. 小型文本文件（非音视频、≤32KB、内容像文本）：内容内联到提示词
 * 4. 其余文件：下载保存到临时目录，提示词里记录保存路径
 * 5. 下载失败：提示词里记录失败原因
 * ============================================================
 */

/** 附件处理结果：图片列表 + 文字说明列表 */
export interface ProcessedAttachments {
  images: ImageInput[];
  notes: string[];
}

/** 文本文件大小上限：超过则视为不可内联 */
const TEXT_SIZE_LIMIT = 32 * 1024;

/** 附件落盘文件名：优先用原始文件名，没有则用 fileKey.bin */
function resourceFileName(fileKey: string, fileName: string | undefined): string {
  return fileName ?? `${fileKey}.bin`;
}

/**
 * 处理一条消息的所有附件。
 * 每个资源单独 try/catch：单个失败不影响其他资源。
 */
export async function processAttachments(options: {
  channel: Pick<FeishuChannel, "downloadResource">;
  config: FeishuConfig;
  message: FeishuMessage;
  sessionKey: string;
  supportsImages: boolean;
}): Promise<ProcessedAttachments> {
  const images: ImageInput[] = [];
  const notes: string[] = [];

  for (const resource of options.message.resources) {
    if (resource.type === "sticker") continue;
    const fileName = resourceFileName(resource.fileKey, resource.fileName);

    try {
      const buffer = await options.channel.downloadResource(options.message.messageId, resource.fileKey, resource.type);

      // 图片且模型支持：转 base64 作为图像输入
      if (resource.type === "image" && options.supportsImages) {
        images.push({
          type: "image",
          data: buffer.toString("base64"),
          mimeType: inferMimeType(fileName),
        });
        continue;
      }

      // 小型文本（非音视频）：内容直接内联进提示词
      if (resource.type !== "audio" && resource.type !== "video" && buffer.length <= TEXT_SIZE_LIMIT && isLikelyText(buffer)) {
        notes.push(`[Attachment text: ${fileName}]\n${buffer.toString("utf-8")}`);
        continue;
      }

      // 其他文件：下载到临时目录，提示词记录路径（模型可用它读取）
      const filePath = await writeTempAttachment(options.config.files.tempDir ?? ".", options.sessionKey, fileName, buffer);
      notes.push(`[Attachment saved: ${fileName} -> ${filePath}]`);
    } catch (error) {
      // 下载/处理失败：提示词里记录原因
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`[Attachment failed: ${fileName}: ${message}]`);
    }
  }

  return { images, notes };
}
