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
  status: "ok" | "degraded";
  apiVersion: string;
  serverVersion: string;
  serverTime: string;
  mock: boolean;
  provider?: "deepseek" | "qwen";
  providerLabel?: string;
  hasApiKey: boolean;
  models: {
    default: string;
    reasoner: string;
  };
}

export type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; info: HealthInfo }
  | { kind: "error" };

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  createdAt: string;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}
