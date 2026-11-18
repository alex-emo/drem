export type Theme = "dark" | "light";

export type ChatRole = "user" | "assistant";

export type MessageStatus = "streaming" | "done" | "error";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  status: MessageStatus;
  error?: string;
  createdAt: number;
}

export interface HealthInfo {
  ok: boolean;
  mock: boolean;
  hasKey: boolean;
  model?: string;
}
