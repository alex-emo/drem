import { openDB, type DBSchema } from "idb";
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

const dbPromise = openDB<DreamDB>("dream", 1, {
  upgrade(db) {
    const conversations = db.createObjectStore("conversations", { keyPath: "id" });
    conversations.createIndex("by-updated", "updatedAt");
    const messages = db.createObjectStore("messages", { keyPath: "id" });
    messages.createIndex("by-conversation", "conversationId");
    messages.createIndex("by-created", "createdAt");
  },
});

export async function listConversations(): Promise<Conversation[]> {
  const db = await dbPromise;
  const items = await db.getAll("conversations");
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putConversation(conversation: Conversation): Promise<void> {
  const db = await dbPromise;
  await db.put("conversations", conversation);
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const db = await dbPromise;
  const items = await db.getAllFromIndex("messages", "by-conversation", conversationId);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putMessage(message: Message): Promise<void> {
  const db = await dbPromise;
  await db.put("messages", message);
}

export async function deleteConversationData(conversationId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(["conversations", "messages"], "readwrite");
  await tx.objectStore("conversations").delete(conversationId);
  const keys = await tx.objectStore("messages").index("by-conversation").getAllKeys(conversationId);
  await Promise.all(keys.map((key) => tx.objectStore("messages").delete(key)));
  await tx.done;
}
