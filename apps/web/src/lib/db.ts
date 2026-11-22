import { openDB, type DBSchema } from "idb";
import { decryptText, encryptText, hasSessionKey } from "./crypto";
import type { Conversation, Message } from "./types";

interface DreamDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { "by-updated": number };
  };
  messages: {
    key: string;
    value: Message;
    indexes: { "by-conversation": string; "by-created": number };
  };
}

function markBackupDirty(): void {
  try {
    localStorage.setItem("dream-backup-rev", String(Date.now()));
  } catch {
    // localStorage 不可用时只影响自动备份判断，不影响聊天保存
  }
}

const dbPromise = openDB<DreamDB>("dream", 1, {
  upgrade(db) {
    const conversations = db.createObjectStore("conversations", { keyPath: "id" });
    conversations.createIndex("by-updated", "updatedAt");
    const messages = db.createObjectStore("messages", { keyPath: "id" });
    messages.createIndex("by-conversation", "conversationId");
    messages.createIndex("by-created", "createdAt");
  },
});

async function decryptConversation(record: Conversation): Promise<Conversation> {
  if (!record.encTitle) return record;
  const title = await decryptText(record.encTitle);
  return { ...record, title, encTitle: undefined };
}

async function encryptConversation(record: Conversation): Promise<Conversation> {
  if (!hasSessionKey() || record.encTitle) return record;
  return { ...record, title: "", encTitle: await encryptText(record.title) };
}

async function decryptMessage(record: Message): Promise<Message> {
  if (!record.enc && !record.encReasoning) return record;
  return {
    ...record,
    content: record.enc ? await decryptText(record.enc) : record.content,
    reasoning: record.encReasoning ? await decryptText(record.encReasoning) : record.reasoning,
    enc: undefined,
    encReasoning: undefined,
  };
}

async function encryptMessage(record: Message): Promise<Message> {
  if (!hasSessionKey() || record.enc) return record;
  return {
    ...record,
    content: "",
    reasoning: undefined,
    enc: await encryptText(record.content),
    encReasoning: record.reasoning ? await encryptText(record.reasoning) : undefined,
  };
}

export async function listConversations(): Promise<Conversation[]> {
  const db = await dbPromise;
  const items = await db.getAll("conversations");
  const decrypted = await Promise.all(items.map(decryptConversation));
  return decrypted.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putConversation(conversation: Conversation): Promise<void> {
  const db = await dbPromise;
  await db.put("conversations", await encryptConversation(conversation));
  markBackupDirty();
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const db = await dbPromise;
  const items = await db.getAllFromIndex("messages", "by-conversation", conversationId);
  const decrypted = await Promise.all(items.map(decryptMessage));
  return decrypted.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putMessage(message: Message): Promise<void> {
  const db = await dbPromise;
  await db.put("messages", await encryptMessage(message));
  markBackupDirty();
}

export async function putMessages(messages: Message[]): Promise<void> {
  if (messages.length === 0) return;
  const db = await dbPromise;
  const encrypted = await Promise.all(messages.map(encryptMessage));
  const tx = db.transaction("messages", "readwrite");
  for (const message of encrypted) {
    await tx.store.put(message);
  }
  await tx.done;
  markBackupDirty();
}

export async function importConversationData(
  conversations: Conversation[],
  messages: Message[],
): Promise<void> {
  const db = await dbPromise;
  const encryptedConversations = await Promise.all(conversations.map(encryptConversation));
  const encryptedMessages = await Promise.all(messages.map(encryptMessage));
  const tx = db.transaction(["conversations", "messages"], "readwrite");
  const conversationStore = tx.objectStore("conversations");
  const messageStore = tx.objectStore("messages");
  for (const conversation of encryptedConversations) {
    await conversationStore.put(conversation);
  }
  for (const message of encryptedMessages) {
    await messageStore.put(message);
  }
  await tx.done;
  markBackupDirty();
}

export async function deleteConversationData(conversationId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(["conversations", "messages"], "readwrite");
  await tx.objectStore("conversations").delete(conversationId);
  const keys = await tx.objectStore("messages").index("by-conversation").getAllKeys(conversationId);
  await Promise.all(keys.map((key) => tx.objectStore("messages").delete(key)));
  await tx.done;
  markBackupDirty();
}

export async function clearLocalChats(): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(["conversations", "messages"], "readwrite");
  await tx.objectStore("conversations").clear();
  await tx.objectStore("messages").clear();
  await tx.done;
  localStorage.removeItem("dream-active-id");
  markBackupDirty();
}

export async function getAllMessages(): Promise<Message[]> {
  const db = await dbPromise;
  const items = await db.getAll("messages");
  return Promise.all(items.map(decryptMessage));
}

export async function getAllConversations(): Promise<Conversation[]> {
  const db = await dbPromise;
  const items = await db.getAll("conversations");
  return Promise.all(items.map(decryptConversation));
}

/** 登录拿到密钥后，把历史明文记录静默迁移为本地加密存储。 */
export async function migrateLocalEncryption(): Promise<{ conversations: number; messages: number }> {
  if (!hasSessionKey()) return { conversations: 0, messages: 0 };
  const db = await dbPromise;
  let conversations = 0;
  let messages = 0;
  const conversationRecords = await db.getAll("conversations");
  const encryptedConversations: Conversation[] = [];
  for (const record of conversationRecords) {
    if (record.encTitle || !record.title) continue;
    encryptedConversations.push(await encryptConversation(record));
    conversations += 1;
  }
  if (encryptedConversations.length) {
    const conversationTx = db.transaction("conversations", "readwrite");
    for (const record of encryptedConversations) await conversationTx.store.put(record);
    await conversationTx.done;
  }
  const messageRecords = await db.getAll("messages");
  const encryptedMessages: Message[] = [];
  for (const record of messageRecords) {
    if (record.enc || (!record.content && !record.reasoning)) continue;
    encryptedMessages.push(await encryptMessage(record));
    messages += 1;
  }
  if (encryptedMessages.length) {
    const messageTx = db.transaction("messages", "readwrite");
    for (const record of encryptedMessages) await messageTx.store.put(record);
    await messageTx.done;
  }
  return { conversations, messages };
}
