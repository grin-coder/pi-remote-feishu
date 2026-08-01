/**
 * 附件 MIME 类型推断工具。
 */

/** 常见图片扩展名 -> MIME 类型 */
const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

/** 根据文件名后缀推断 MIME 类型；未知扩展名返回通用二进制类型 */
export function inferMimeType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * 粗略判断一段 Buffer 是否像文本：
 * 前 4KB 里只要出现字节 0（NUL），就认为不是文本。
 * 用于决定小文件是内联内容还是落盘保存。
 */
export function isLikelyText(buffer: Buffer): boolean {
  return !buffer.subarray(0, 4096).includes(0);
}
