import { getToken } from "./auth";
import type { AuthResult, AuthUser } from "./types";

export interface ApiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatStart {
  requestId: string;
  model: string;
  thinking: boolean;
  createdAt: string;
}

export interface ChatDone {
  requestId: string;
  finishReason: "stop" | "length" | "content_filter" | "unknown";
  createdAt: string;
}

export interface StreamChatOptions {
  messages: ApiChatMessage[];
  thinking: boolean;
  signal: AbortSignal;
  onStart?: (start: ChatStart) => void;
  onDelta: (text: string) => void;
  onReasoning: (text: string) => void;
  /** 内容安全拒绝：服务端返回固定答复，前端按正常回复展示。 */
  onRefusal?: (text: string) => void;
  onDone?: (done: ChatDone) => void;
}

export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(message: string, status: number, code = "UNKNOWN", requestId?: string) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
}

export const CHAT_ENDPOINT = "/api/v1/chat";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as ErrorBody | null;
    throw new ChatApiError(
      data?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.requestId,
    );
  }

  return (await response.json()) as T;
}

export async function registerAccount(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<AuthResult> {
  return requestJson<AuthResult>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loginAccount(input: {
  username: string;
  password: string;
}): Promise<AuthResult> {
  return requestJson<AuthResult>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchMe(): Promise<AuthUser> {
  const data = await requestJson<{ user: AuthUser }>("/api/v1/me");
  return data.user;
}

export async function logoutAccount(): Promise<void> {
  try {
    await requestJson<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" });
  } catch {
    // 本地凭证无论如何都要清掉
  }
}

export interface SharedChatMessage {
  role: "user" | "assistant";
  content: string;
  reasoning: string;
  status: "done" | "error";
  createdAt: number;
}

export interface SharedChatResponse {
  shareId: string;
  title: string;
  attachments: number;
  messages: SharedChatMessage[];
}

export async function fetchSharedChat(url: string): Promise<SharedChatResponse> {
  return requestJson<SharedChatResponse>(`/api/v1/import/share?url=${encodeURIComponent(url)}`);
}

/**
 * 请求 Dream Server，解析归一化后的 SSE 事件：
 * start → (thinking | delta)* → done | error
 */
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { messages, thinking, signal, onStart, onDelta, onReasoning, onRefusal, onDone } = options;

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...authHeaders(),
    },
    body: JSON.stringify({ messages, thinking }),
    signal,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as ErrorBody | null;
    throw new ChatApiError(
      data?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.requestId,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new ChatApiError("服务端返回了非流式响应", response.status, "INVALID_RESPONSE");
  }

  if (!response.body) {
    throw new ChatApiError("当前浏览器不支持流式响应", 0, "NO_STREAM_SUPPORT");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleBlock = (block: string): boolean => {
    let event = "message";
    const dataLines: string[] = [];

    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }

    if (dataLines.length === 0) return false;
    const payload = dataLines.join("\n").trim();
    if (!payload) return false;

    let data: unknown;
    try {
      data = JSON.parse(payload) as unknown;
    } catch {
      return false;
    }

    switch (event) {
      case "start": {
        onStart?.(data as ChatStart);
        return false;
      }
      case "delta": {
        const delta = (data as { delta?: unknown }).delta;
        if (typeof delta === "string" && delta) onDelta(delta);
        return false;
      }
      case "thinking": {
        const delta = (data as { delta?: unknown }).delta;
        if (typeof delta === "string" && delta) onReasoning(delta);
        return false;
      }
      case "refusal": {
        const message = (data as { message?: unknown }).message;
        if (typeof message === "string" && message) onRefusal?.(message);
        return false;
      }
      case "done": {
        onDone?.(data as ChatDone);
        return true;
      }
      case "error": {
        const error = (data as { error?: { code?: string; message?: string; requestId?: string } })
          .error;
        throw new ChatApiError(
          error?.message ?? "生成失败，请稍后重试",
          0,
          error?.code ?? "UPSTREAM_ERROR",
          error?.requestId,
        );
      }
      default:
        // 未知事件忽略，保留前向兼容空间
        return false;
    }
  };

  const drain = async (end: boolean) => {
    for (;;) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (handleBlock(block)) return true;
    }
    if (end && buffer.trim()) return handleBlock(buffer.replace(/\r\n/g, "\n"));
    return false;
  };

  try {
    buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      if (await drain(false)) {
        await reader.cancel().catch(() => undefined);
        return;
      }
    }

    buffer += decoder.decode();
    if (await drain(true)) return;
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
}

/**
 * 导入长对话后静默预热上下文压缩：服务端按分段生成摘要并缓存，
 * 首次发消息时不必再等摘要生成。
 */
export async function warmContext(messages: ApiChatMessage[]): Promise<void> {
  const response = await fetch("/api/v1/context/warm", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok) {
    throw new ChatApiError("上下文预热失败", response.status, "WARM_FAILED");
  }
}
