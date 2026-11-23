import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_BACKUP_BYTES,
  backupFilePath,
  deleteBackupFile,
  readBackupBytes,
  saveBackupStream,
} from "../../../apps/server/src/backups.js";
import { ApiError } from "../../../apps/server/src/protocol.js";

function chunkStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("saveBackupStream", () => {
  it("流式写入备份并返回大小", async () => {
    const saved = await saveBackupStream("user_backup_1", chunkStream([bytes("hello "), bytes("world")]));
    expect(saved.size).toBe(11);
    expect(saved.path).toBe(backupFilePath("user_backup_1"));
    expect(readBackupBytes(saved.path).toString()).toBe("hello world");
  });

  it("覆盖旧备份时原子替换", async () => {
    const first = await saveBackupStream("user_backup_2", chunkStream([bytes("old")]));
    const second = await saveBackupStream("user_backup_2", chunkStream([bytes("new-content")]));
    expect(second.path).toBe(first.path);
    expect(readBackupBytes(second.path).toString()).toBe("new-content");
  });

  it("空请求体被拒绝", async () => {
    await expect(saveBackupStream("user_backup_3", null)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      status: 400,
    });
  });

  it("零字节流被拒绝", async () => {
    await expect(saveBackupStream("user_backup_4", chunkStream([]))).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(existsSync(backupFilePath("user_backup_4"))).toBe(false);
  });

  it("超过 20 MiB 被拒绝且不留下半截文件", async () => {
    const big = new Uint8Array(MAX_BACKUP_BYTES + 1);
    await expect(saveBackupStream("user_backup_5", chunkStream([big]))).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
    expect(existsSync(backupFilePath("user_backup_5"))).toBe(false);
  });

  it("请求中止时清理临时文件", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      saveBackupStream("user_backup_6", chunkStream([bytes("data")]), controller.signal),
    ).rejects.toBeInstanceOf(ApiError);
    expect(existsSync(backupFilePath("user_backup_6"))).toBe(false);
  });
});

describe("deleteBackupFile", () => {
  it("删除存在的备份，忽略空值/重复删除", async () => {
    const saved = await saveBackupStream("user_backup_7", chunkStream([bytes("x")]));
    expect(statSync(saved.path).size).toBe(1);
    deleteBackupFile(saved.path);
    expect(existsSync(saved.path)).toBe(false);
    deleteBackupFile(saved.path);
    deleteBackupFile(null);
    deleteBackupFile(undefined);
  });
});
