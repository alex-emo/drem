import { getToken } from "./auth";
import { getSessionKey, setSessionKey, decryptBytes, encryptBytes, hasSessionKey } from "./crypto";
import { clearLocalChats, getAllConversations, getAllMessages, importConversationData, migrateLocalEncryption } from "./db";
import type { Conversation, Message } from "./types";

interface BackupPayload {
  payload: string;
  updatedAt: string;
  size: number;
}

export interface CloudBackupInfo {
  key: string;
  backup: BackupPayload | null;
}

interface BackupData {
  format: "dream-backup";
  version: 1;
  exportedAt: string;
  conversations: Conversation[];
  messages: Message[];
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message ?? `云端备份请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}

function encodePayload(iv: string, data: string): string {
  return `dream1.${iv}.${data}`;
}

function decodePayload(payload: string): { iv: string; data: string } {
  const [tag, iv, data] = payload.split(".");
  if (tag !== "dream1" || !iv || !data) throw new Error("云端备份格式不正确。");
  return { iv, data };
}

export async function fetchCloudInfo(): Promise<CloudBackupInfo> {
  return api<CloudBackupInfo>("/api/v1/backup");
}

async function gzip(text: string): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return new TextEncoder().encode(text);
  const blob = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === "undefined") return new TextDecoder().decode(bytes);
  return new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

export async function mergeBackup(data: BackupData): Promise<{ conversations: number; messages: number }> {
  const localConversations = new Map((await getAllConversations()).map((item) => [item.id, item]));
  const localMessages = new Map((await getAllMessages()).map((item) => [item.id, item]));
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  for (const incoming of data.conversations ?? []) {
    const local = localConversations.get(incoming.id);
    if (!local || incoming.updatedAt > local.updatedAt) conversations.push(incoming);
  }
  for (const incoming of data.messages ?? []) {
    const local = localMessages.get(incoming.id);
    if (!local) messages.push(incoming);
    else if (incoming.createdAt >= local.createdAt && incoming.content !== local.content) messages.push(incoming);
  }
  await importConversationData(conversations, messages);
  return { conversations: conversations.length, messages: messages.length };
}

export async function pullCloudBackup(info: CloudBackupInfo): Promise<{ conversations: number; messages: number } | null> {
  if (!info.backup) return null;
  const { iv, data } = decodePayload(info.backup.payload);
  const bytes = await decryptBytes({ iv, data });
  const parsed = JSON.parse(await gunzip(bytes)) as BackupData;
  return mergeBackup(parsed);
}

export async function pushCloudBackup(): Promise<{ size: number; updatedAt: string }> {
  const conversations = await getAllConversations();
  const messages = await getAllMessages();
  const payload: BackupData = {
    format: "dream-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations,
    messages,
  };
  const compressed = await gzip(JSON.stringify(payload));
  const encrypted = await encryptBytes(compressed);
  const body = JSON.stringify({ payload: encodePayload(encrypted.iv, encrypted.data) });
  return api<{ size: number; updatedAt: string }>("/api/v1/backup", { method: "PUT", body });
}

export interface UnlockResult {
  key: string;
  hadCloudBackup: boolean;
  localConversations: number;
  merged: { conversations: number; messages: number } | null;
  pullError?: string;
}

/** 登录后：取服务端密钥 → 迁移本地加密 → 拉取云端并合并。 */
export async function unlockAccount(userId: string): Promise<UnlockResult> {
  const owner = localStorage.getItem("dream-local-owner");
  if (owner && owner !== userId) {
    // 同一浏览器切换账号：旧账号的记录用旧密钥加密，新账号不可读，先清空（云端仍有备份）。
    await clearLocalChats();
  }
  localStorage.setItem("dream-local-owner", userId);
  const info = await fetchCloudInfo();
  setSessionKey(info.key);
  await migrateLocalEncryption();
  const localConversations = (await getAllConversations()).length;
  let merged: { conversations: number; messages: number } | null = null;
  let pullError: string | undefined;
  try {
    merged = await pullCloudBackup(info);
  } catch (error) {
    pullError = error instanceof Error ? error.message : "云端备份无法解密，已保留本地记录。";
  }
  return { key: info.key, hadCloudBackup: Boolean(info.backup), localConversations, merged, pullError };
}

export function lockAccount(): void {
  setSessionKey(null);
}

export function accountUnlocked(): boolean {
  return hasSessionKey();
}

export async function maybePushCloudBackup(): Promise<void> {
  if (!getSessionKey()) return;
  if (localStorage.getItem("dream-cloud-upload-declined") === "1") return;
  const last = Number(localStorage.getItem("dream-cloud-last-push")) || 0;
  const rev = Number(localStorage.getItem("dream-backup-rev")) || 0;
  if (!rev || rev <= last) return;
  if (Date.now() - last < 5 * 60 * 1000) return;
  try {
    await pushCloudBackup();
    localStorage.setItem("dream-cloud-last-push", String(Date.now()));
  } catch {
    // 网络差时下次再试
  }
}
