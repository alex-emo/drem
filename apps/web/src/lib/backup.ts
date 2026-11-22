import { getAllConversations, getAllMessages, importConversationData } from "./db";
import { writeBackupBlob } from "./backupTarget";
import { decryptBytes, encryptBytes, hasSessionKey } from "./crypto";

export interface DreamBackup {
  format: "dream-backup";
  version: 1;
  exportedAt: string;
  conversations: Awaited<ReturnType<typeof getAllConversations>>;
  messages: Awaited<ReturnType<typeof getAllMessages>>;
}

interface DreamExportEnvelope {
  format: "dream-export";
  version: 1;
  exportedAt: string;
  encrypted: boolean;
  algorithm?: "AES-GCM";
  compression?: "gzip";
  iv?: string;
  data?: string;
  backup?: DreamBackup;
}

export async function collectBackup(): Promise<DreamBackup> {
  return {
    format: "dream-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations: await getAllConversations(),
    messages: await getAllMessages(),
  };
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return bytes;
  const blob = await new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") return bytes;
  const blob = await new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

/** 导出：自有 dream-export 格式，默认用登录密钥静默加密（gzip + AES-GCM）。 */
export async function createBackup(): Promise<Blob> {
  if (!hasSessionKey()) throw new Error("请先登录并解锁聊天记录，再导出备份。");
  const backup = await collectBackup();
  const compressed = await gzip(new TextEncoder().encode(JSON.stringify(backup)));
  const encrypted = await encryptBytes(compressed);
  const envelope: DreamExportEnvelope = {
    format: "dream-export",
    version: 1,
    exportedAt: backup.exportedAt,
    encrypted: true,
    algorithm: "AES-GCM",
    compression: "gzip",
    iv: encrypted.iv,
    data: encrypted.data,
  };
  return new Blob([JSON.stringify(envelope)], { type: "application/json" });
}

export function backupFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `dream-export-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.dream`;
}

export async function downloadBackup(): Promise<"file" | "download"> {
  const blob = await createBackup();
  return writeBackupBlob(blob, backupFileName());
}

async function readFileText(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const isGzip = (head[0] === 0x1f && head[1] === 0x8b) || file.name.endsWith(".gz");
  if (isGzip) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持解压旧备份文件，请换用较新的浏览器。");
    }
    return new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }
  return file.text();
}

function validate(backup: DreamBackup): DreamBackup {
  if (!Array.isArray(backup.conversations) || !Array.isArray(backup.messages)) {
    throw new Error("备份文件内容不完整。");
  }
  return backup;
}

/** 导入：支持新 dream-export（加密/明文）、旧 dream-backup，以及旧 .json.gz。 */
async function readBackupFile(file: File): Promise<DreamBackup> {
  const text = await readFileText(file);
  const parsed = JSON.parse(text) as Partial<DreamExportEnvelope> & Partial<DreamBackup>;

  if (parsed.format === "dream-export") {
    if (parsed.encrypted) {
      if (!parsed.iv || !parsed.data) throw new Error("加密备份缺少必要字段。");
      if (!hasSessionKey()) throw new Error("这是加密备份，请先登录后导入。");
      const decrypted = await decryptBytes({ iv: parsed.iv, data: parsed.data });
      const plain = parsed.compression === "gzip" ? await gunzip(decrypted) : decrypted;
      const backup = JSON.parse(new TextDecoder().decode(plain)) as DreamBackup;
      return validate(backup);
    }
    if (parsed.backup) return validate(parsed.backup);
    throw new Error("备份文件内容不完整。");
  }

  if (parsed.format === "dream-backup" && parsed.version === 1) {
    return validate(parsed as DreamBackup);
  }
  throw new Error("这不是 Dream 的备份文件。");
}

export async function restoreBackup(file: File): Promise<{ conversations: number; messages: number }> {
  const backup = await readBackupFile(file);
  await importConversationData(backup.conversations, backup.messages);
  return { conversations: backup.conversations.length, messages: backup.messages.length };
}

export function backupSignature(): string {
  // 只需要判断“是否有变化”，不用于安全。
  return `${localStorage.getItem("dream-backup-rev") ?? ""}`;
}

export function markBackupChanged(): void {
  localStorage.setItem("dream-backup-rev", String(Date.now()));
}
