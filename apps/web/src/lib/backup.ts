import { getAllConversations, getAllMessages, importConversationData } from "./db";
import { writeBackupBlob } from "./backupTarget";

export interface DreamBackup {
  format: "dream-backup";
  version: 1;
  exportedAt: string;
  conversations: Awaited<ReturnType<typeof getAllConversations>>;
  messages: Awaited<ReturnType<typeof getAllMessages>>;
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

export async function createBackup(): Promise<Blob> {
  const payload: DreamBackup = {
    format: "dream-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations: await getAllConversations(),
    messages: await getAllMessages(),
  };
  const json = JSON.stringify(payload);
  if (typeof CompressionStream === "undefined") {
    return new Blob([json], { type: "application/json" });
  }
  const compressed = await new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
  ).blob();
  return new Blob([compressed], { type: "application/gzip" });
}

export function backupFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `dream-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json.gz`;
}

export async function downloadBackup(): Promise<"file" | "download"> {
  const blob = await createBackup();
  return writeBackupBlob(blob, backupFileName());
}

async function readBackupFile(file: File): Promise<DreamBackup> {
  let text: string;
  if (file.name.endsWith(".gz")) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持解压备份文件，请换用较新的浏览器。");
    }
    const decompressed = await new Response(
      file.stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    text = decompressed;
  } else {
    text = await file.text();
  }
  const parsed = JSON.parse(text) as Partial<DreamBackup>;
  if (parsed.format !== "dream-backup" || parsed.version !== 1) {
    throw new Error("这不是 Dream 的备份文件。");
  }
  if (!Array.isArray(parsed.conversations) || !Array.isArray(parsed.messages)) {
    throw new Error("备份文件内容不完整。");
  }
  return parsed as DreamBackup;
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
