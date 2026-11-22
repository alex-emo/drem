import { getToken } from "./auth";
import { getSessionKey, setSessionKey, decryptBytes, encryptBytes, hasSessionKey } from "./crypto";
import {
  clearLocalChats,
  deleteConversationData,
  getAllConversations,
  getAllMessages,
  getAllTombstones,
  importConversationData,
  migrateLocalEncryption,
  putTombstone,
  type Tombstone,
} from "./db";
import type { Conversation, Message } from "./types";

interface BackupPayload {
  payload: string;
  updatedAt: string;
  size: number;
}

export interface CloudBackupInfo {
  key: string;
  legacyKey?: string;
  backup: BackupPayload | null;
}

interface BackupData {
  format: "dream-backup";
  version: 2;
  exportedAt: string;
  conversations: Conversation[];
  messages: Message[];
  tombstones?: Tombstone[];
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("云端同步超时，请检查网络后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  const [localConversations, localMessages, localTombstones] = await Promise.all([
    getAllConversations(),
    getAllMessages(),
    getAllTombstones(),
  ]);
  const localConversationMap = new Map(localConversations.map((item) => [item.id, item]));
  const localMessageMap = new Map(localMessages.map((item) => [item.id, item]));
  const tombstones = new Map(localTombstones.map((item) => [item.id, item]));

  // 合并墓碑：保留较新的删除时间；删除时间晚于本地会话更新时间的才生效。
  for (const incoming of data.tombstones ?? []) {
    const current = tombstones.get(incoming.id);
    if (!current || incoming.deletedAt > current.deletedAt) {
      tombstones.set(incoming.id, incoming);
      await putTombstone(incoming);
    }
  }

  const deletedUntil = new Map<string, number>();
  for (const tombstone of tombstones.values()) {
    const local = localConversationMap.get(tombstone.id);
    if (!local || local.updatedAt <= tombstone.deletedAt) {
      deletedUntil.set(tombstone.id, tombstone.deletedAt);
      if (local) await deleteConversationData(tombstone.id);
    }
  }

  const conversationIds = new Set((data.conversations ?? []).map((item) => item.id));
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  for (const incoming of data.conversations ?? []) {
    if ((deletedUntil.get(incoming.id) ?? 0) >= incoming.updatedAt) continue;
    const local = localConversationMap.get(incoming.id);
    if (!local || incoming.updatedAt > local.updatedAt) conversations.push(incoming);
  }
  for (const incoming of data.messages ?? []) {
    if (!conversationIds.has(incoming.conversationId)) continue;
    if ((deletedUntil.get(incoming.conversationId) ?? 0) >= incoming.createdAt) continue;
    const local = localMessageMap.get(incoming.id);
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

async function existingCloudSessions(): Promise<unknown[] | undefined> {
  try {
    const info = await fetchCloudInfo();
    if (!info.backup) return undefined;
    const { iv, data } = decodePayload(info.backup.payload);
    const parsed = JSON.parse(await gunzip(await decryptBytes({ iv, data }))) as BackupData & { sessions?: unknown[] };
    return parsed.sessions;
  } catch {
    return undefined;
  }
}

export async function pushCloudBackup(rawLimitBytes = 8_000_000): Promise<{ size: number; updatedAt: string }> {
  const [conversations, messages, tombstones, sessions] = await Promise.all([
    getAllConversations(),
    getAllMessages(),
    getAllTombstones(),
    existingCloudSessions(),
  ]);
  const payload: BackupData & { sessions?: unknown[] } = {
    format: "dream-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    conversations,
    messages,
    tombstones,
    ...(sessions?.length ? { sessions } : {}),
  };
  const json = JSON.stringify(payload);
  const rawBytes = new TextEncoder().encode(json).byteLength;
  if (rawBytes > rawLimitBytes) {
    throw new Error(
      `云端备份内容约 ${(rawBytes / 1024 / 1024).toFixed(1)} MB，超过自动上传上限 ${(rawLimitBytes / 1024 / 1024).toFixed(1)} MB；请手动导出备份，或清理较早会话。`,
    );
  }
  const compressed = await gzip(json);
  const encrypted = await encryptBytes(compressed);
  const body = JSON.stringify({ payload: encodePayload(encrypted.iv, encrypted.data) });
  if (new TextEncoder().encode(body).byteLength > 11_800_000) {
    throw new Error("云端备份编码后超过服务端 12 MB 上限；请手动导出并清理较早会话。");
  }
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
async function rekeyLocalData(oldKey: string, newKey: string): Promise<void> {
  setSessionKey(oldKey);
  const conversations = await getAllConversations();
  const messages = await getAllMessages();
  setSessionKey(newKey);
  await importConversationData(conversations, messages);
}

export async function unlockAccount(userId: string): Promise<UnlockResult> {
  const owner = localStorage.getItem("dream-local-owner");
  if (owner && owner !== userId) {
    // 同一浏览器切换账号：旧账号的记录用旧密钥加密，新账号不可读，先清空（云端仍有备份）。
    await clearLocalChats();
  }
  localStorage.setItem("dream-local-owner", userId);
  const info = await fetchCloudInfo();
  const storedKey = localStorage.getItem("dream-encryption-key");
  const needsLegacyMigration = Boolean(info.legacyKey) && storedKey !== info.key;
  let merged: { conversations: number; messages: number } | null = null;
  let pullError: string | undefined;
  let localConversations = 0;
  if (needsLegacyMigration) {
    setSessionKey(info.legacyKey!);
    try {
      await migrateLocalEncryption();
      localConversations = (await getAllConversations()).length;
    } catch {
      // 本地可能是旧密钥且已无法解密，清空后从旧云端备份恢复。
      await clearLocalChats();
      localConversations = 0;
    }
    try {
      merged = await pullCloudBackup(info);
    } catch {
      // 旧备份可能不存在或已损坏，不阻断升级。
    }
    await rekeyLocalData(info.legacyKey!, info.key);
    setSessionKey(info.key);
    try {
      await pushCloudBackup();
      localStorage.setItem("dream-encryption-key", info.key);
    } catch {
      // 下次登录继续尝试覆盖旧备份。
    }
  } else {
    setSessionKey(info.key);
    try {
      await migrateLocalEncryption();
      localConversations = (await getAllConversations()).length;
      merged = await pullCloudBackup(info);
    } catch (error) {
      // 密钥不匹配时不要立刻毁掉本地记录：先尝试拉云端；本地不可解密记录会在展示层跳过。
      pullError =
        error instanceof Error
          ? `本地聊天记录无法解密（${error.message}），已尝试从云端恢复。`
          : "本地聊天记录无法解密，已尝试从云端恢复。";
      try {
        merged = await pullCloudBackup(info);
      } catch (retryError) {
        pullError = retryError instanceof Error ? retryError.message : "云端备份无法解密。";
      }
    }
    localStorage.setItem("dream-encryption-key", info.key);
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
  if (localStorage.getItem("dream-cloud-upload-pending") === "1") return;
  const last = Number(localStorage.getItem("dream-cloud-last-push")) || 0;
  const rev = Number(localStorage.getItem("dream-backup-rev")) || 0;
  if (!rev || rev <= last) return;
  if (Date.now() - last < 5 * 60 * 1000) return;
  try {
    await pushCloudBackup(6_000_000);
    localStorage.setItem("dream-cloud-last-push", String(Date.now()));
  } catch (error) {
    // 即使失败也要让设置页/控制台可见，而不是静默丢备份。
    console.warn("云端自动备份失败", error);
    try {
      localStorage.setItem(
        "dream-cloud-last-error",
        JSON.stringify({ at: Date.now(), message: (error as Error).message }),
      );
      window.dispatchEvent(
        new CustomEvent("dream:cloud-sync-error", { detail: { message: (error as Error).message } }),
      );
    } catch {
      // 忽略存储/事件失败
    }
  }
}
