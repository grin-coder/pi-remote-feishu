import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FeishuStore, SessionFilter, SessionMapping } from "../types.js";

/**
 * ============================================================
 * JSON 文件存储（FeishuStore 的默认实现）
 * ------------------------------------------------------------
 * 把会话映射(sessionKey -> cwd/sessionFile)持久化到单个 JSON 文件，
 * 实现跨进程重启后的会话恢复。
 *
 * 并发安全：写入操作通过 writeTail promise 链串行化，避免写冲突。
 * ============================================================
 */

/** 存储文件结构 */
interface StoreFile {
  mappings: SessionMapping[];
}

/** 判断映射是否满足过滤条件（未指定字段视为不限制） */
function matchesFilter(mapping: SessionMapping, filter: SessionFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.chatId !== undefined && mapping.chatId !== filter.chatId) return false;
  if (filter.userId !== undefined && mapping.userId !== filter.userId) return false;
  if (filter.chatType !== undefined && mapping.chatType !== filter.chatType) return false;
  return true;
}

/** 校验读到的数据是否为合法 StoreFile 结构 */
function isStoreFile(value: unknown): value is StoreFile {
  if (typeof value !== "object" || value === null || !("mappings" in value)) return false;
  const mappings = (value as { mappings: unknown }).mappings;
  return Array.isArray(mappings);
}

export class JsonFeishuStore implements FeishuStore {
  private readonly filePath: string;
  /** 写操作队列尾：保证 set/delete 串行执行 */
  private writeTail: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** 按 sessionKey 查询映射 */
  async getSessionMapping(sessionKey: string): Promise<SessionMapping | undefined> {
    const file = await this.readStore();
    return file.mappings.find((mapping) => mapping.sessionKey === sessionKey);
  }

  /** 写入（或覆盖）一条映射：已存在则替换，否则追加 */
  async setSessionMapping(mapping: SessionMapping): Promise<void> {
    await this.withWriteLock(async () => {
      const file = await this.readStore();
      const index = file.mappings.findIndex((entry) => entry.sessionKey === mapping.sessionKey);
      if (index === -1) {
        file.mappings.push(mapping);
      } else {
        file.mappings[index] = mapping;
      }
      await this.writeStore(file);
    });
  }

  /** 删除一条映射 */
  async deleteSessionMapping(sessionKey: string): Promise<void> {
    await this.withWriteLock(async () => {
      const file = await this.readStore();
      await this.writeStore({
        mappings: file.mappings.filter((mapping) => mapping.sessionKey !== sessionKey),
      });
    });
  }

  /** 列出全部映射（支持按 chatId / userId / chatType 过滤） */
  async listSessionMappings(filter?: SessionFilter): Promise<SessionMapping[]> {
    const file = await this.readStore();
    return file.mappings.filter((mapping) => matchesFilter(mapping, filter));
  }

  /**
   * 写操作互斥锁：
   * 把本次操作挂到 writeTail 链尾，前一个写完成后再执行，
   * 防止并发 set/delete 造成文件内容丢失。
   */
  private async withWriteLock(run: () => Promise<void>): Promise<void> {
    const previous = this.writeTail;
    let release: () => void = () => {};
    this.writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await run();
    } finally {
      release();
    }
  }

  /** 读取存储文件；文件不存在或结构非法时按空映射处理 */
  private async readStore(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isStoreFile(parsed)) {
        return { mappings: parsed.mappings as SessionMapping[] };
      }
    } catch (error) {
      // 文件不存在：返回空（首次运行时）
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { mappings: [] };
      }
      throw error;
    }
    return { mappings: [] };
  }

  /** 写存储文件（自动创建目录，美化 JSON 格式） */
  private async writeStore(file: StoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  }
}
