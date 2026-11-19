export type Theme = "dark" | "light";

export type ChatRole = "user" | "assistant";

export type MessageStatus = "streaming" | "done" | "refused" | "error";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 消息树的根节点；编辑第一条提问后可能换根。 */
  rootMessageId?: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  status: MessageStatus;
  error?: string;
  /** 服务端错误码与请求编号，便于用户报障时定位日志。 */
  errorCode?: string;
  errorRequestId?: string;
  createdAt: number;
  /** 消息树结构：同一父节点下可以有多个版本。 */
  parentId?: string | null;
  selectedChildId?: string | null;
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
  keys?: {
    total: number;
    available: number;
  };
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
  isAdmin?: boolean;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}
