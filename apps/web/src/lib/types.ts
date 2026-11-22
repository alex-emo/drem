export type Theme = "dark" | "light";

export type ChatRole = "user" | "assistant";

export type MessageStatus = "streaming" | "done" | "refused" | "stopped" | "error";

export interface EncryptedTitle {
  iv: string;
  data: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 消息树的根节点；编辑第一条提问后可能换根。 */
  rootMessageId?: string | null;
  /** 本地加密后的标题；有值时 title 为空。 */
  encTitle?: EncryptedTitle;
}

export interface FileAttachment {
  id: string;
  name: string;
  bytes: number;
  chars: number;
  createdAt: string;
  preview?: string;
}

export interface SearchSource {
  index: number;
  title: string;
  url: string;
  siteName?: string;
  icon?: string;
}

export interface EncryptedMessageText {
  iv: string;
  data: string;
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
  webSearch?: boolean;
  files?: FileAttachment[];
  sources?: SearchSource[];
  createdAt: number;
  /** 消息树结构：同一父节点下可以有多个版本。 */
  parentId?: string | null;
  selectedChildId?: string | null;
  /** 本地加密后的正文/思考；有值时 content/reasoning 为空。 */
  enc?: EncryptedMessageText;
  encReasoning?: EncryptedMessageText;
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
