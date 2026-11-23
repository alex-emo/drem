import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { config } from "./config.js";
import { ApiError } from "./protocol.js";

/** 云备份加密后的硬上限。压缩+加密后的备份不超过 20 MiB。 */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

const backupDir = resolve(config.backupDir);

export interface SavedBackup {
  path: string;
  size: number;
}

export function backupFilePath(userId: string): string {
  return resolve(backupDir, `${userId}.bin`);
}

/**
 * 把请求体直接流式写入备份文件，边写边限长，避免把 20MB 备份整体读进内存。
 * 先写临时文件，成功后再原子替换；任何失败都会清理临时文件。
 */
export async function saveBackupStream(
  userId: string,
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): Promise<SavedBackup> {
  if (!body) throw new ApiError(400, "INVALID_ARGUMENT", "备份内容不能为空");
  mkdirSync(backupDir, { recursive: true });
  const target = backupFilePath(userId);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const out = createWriteStream(temp);
  // 超限/客户端取消时会先 destroy；吞掉随后可能到达的 write error，避免进程级 unhandled error。
  out.on("error", () => undefined);
  let size = 0;
  let settled = false;
  const cleanup = (): void => {
    if (settled) return;
    settled = true;
    out.destroy();
    try {
      unlinkSync(temp);
    } catch {
      // temp 可能还没创建
    }
  };
  const onAbort = (): void => {
    cleanup();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const stream = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
    for await (const chunk of stream) {
      if (signal?.aborted) throw new ApiError(499, "REQUEST_ABORTED", "请求已取消");
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.byteLength;
      if (size > MAX_BACKUP_BYTES) {
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", `云备份超过 ${MAX_BACKUP_BYTES / 1024 / 1024} MiB 上限`);
      }
      if (!out.write(bytes)) {
        await once(out, "drain");
      }
    }
    if (size === 0) throw new ApiError(400, "INVALID_ARGUMENT", "备份内容不能为空");
    await new Promise<void>((resolvePromise, rejectPromise) => {
      out.end((error?: Error | null) => (error ? rejectPromise(error) : resolvePromise()));
    });
    renameSync(temp, target);
    settled = true;
    return { path: target, size };
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export function readBackupBytes(path: string): Buffer {
  return readFileSync(path);
}

export function deleteBackupFile(path: string | null | undefined): void {
  if (!path) return;
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // 清理旧文件失败不影响新备份
  }
}
