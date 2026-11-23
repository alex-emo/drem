import { getToken } from "./auth";
import { deviceName, getDeviceId } from "./device";
import type { AuthResult, AuthUser, Conversation, FileAttachment, Message, SearchSource } from "./types";

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
  files?: string[];
  webSearch?: boolean;
  signal: AbortSignal;
  onSources?: (sources: SearchSource[]) => void;
  onStart?: (start: ChatStart) => void;
  onDelta: (text: string) => void;
  onReasoning: (text: string) => void;
  /** 内容安全拒绝：服务端返回固定答复，前端按正常回复展示。 */
  onRefusal?: (text: string) => void;
  onDone?: (done: ChatDone) => void;
}

const CLIENT_ERROR_HEX: Record<string, string> = {
  NETWORK: "0x0001",
  ABORTED: "0x0002",
  TIMEOUT: "0x0005",
  INVALID_RESPONSE: "0x0003",
  NO_STREAM_SUPPORT: "0x0004",
  HTTP_ERROR: "0x5000",
  UNKNOWN: "0x5001",
};

/** 统一对外错误文案：0x 十六进制错误码 + 中文原因。 */
export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hex: string;
  readonly requestId?: string;

  constructor(message: string, status: number, code = "UNKNOWN", requestId?: string, hex?: string) {
    const ticket = requestId ? `（请求编号 ${requestId}）` : "";
    super(`${hex ?? CLIENT_ERROR_HEX[code] ?? "0x5001"} ${message}${ticket}`);
    this.name = "ChatApiError";
    this.status = status;
    this.code = code;
    this.hex = hex ?? CLIENT_ERROR_HEX[code] ?? "0x5001";
    this.requestId = requestId;
  }
}

interface ErrorBody {
  error?: {
    code?: string;
    hex?: string;
    message?: string;
    requestId?: string;
  };
}

export const CHAT_ENDPOINT = "/api/v1/chat";

const COMPRESS_THRESHOLD = 256 * 1024;

/** 请求体较大时用 gzip，减少手机弱网下上传中断；小请求保持原样。 */
async function encodeJsonBody(value: unknown): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  const text = JSON.stringify(value);
  if (text.length < COMPRESS_THRESHOLD || typeof CompressionStream === "undefined") {
    return { body: text, headers: {} };
  }
  const compressed = await new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return { body: compressed, headers: { "content-encoding": "gzip" } };
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...authHeaders(),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ChatApiError("请求超时，请检查网络后重试。", 0, "TIMEOUT");
    }
    throw new ChatApiError("网络连接失败，请检查网络后重试。", 0, "NETWORK");
  } finally {
    window.clearTimeout(timer);
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as ErrorBody | null;
    throw new ChatApiError(
      data?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.requestId,
      data?.error?.hex,
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
    body: JSON.stringify({ ...input, deviceId: getDeviceId(), deviceName: deviceName(), platform: "web" }),
  });
}

export async function loginAccount(input: {
  username: string;
  password: string;
}): Promise<AuthResult> {
  return requestJson<AuthResult>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ ...input, deviceId: getDeviceId(), deviceName: deviceName(), platform: "web" }),
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
export async function uploadFile(file: File): Promise<FileAttachment> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch("/api/v1/files", {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as ErrorBody | null;
    throw new ChatApiError(
      data?.error?.message ?? `上传失败（HTTP ${response.status}）`,
      response.status,
      data?.error?.code ?? "UPLOAD_FAILED",
      data?.error?.requestId,
      data?.error?.hex,
    );
  }
  return (await response.json()) as FileAttachment;
}

export interface FeedbackReport {
  id: number;
  username: string;
  platform: "web" | "app";
  os: string;
  osVersion: string;
  appVersion: string;
  description: string;
  reproducible: "always" | "sometimes" | "once" | "unknown";
  hasScreenshot: boolean;
  adminReply: string | null;
  repliedBy: string | null;
  repliedAt: string | null;
  status: "open" | "replied" | "closed";
  createdAt: string;
}

export async function submitFeedback(input: {
  platform: "web" | "app";
  os: string;
  osVersion: string;
  appVersion: string;
  description: string;
  reproducible: FeedbackReport["reproducible"];
  screenshot?: File | null;
}): Promise<FeedbackReport> {
  const form = new FormData();
  form.set("platform", input.platform);
  form.set("os", input.os);
  form.set("osVersion", input.osVersion);
  form.set("appVersion", input.appVersion);
  form.set("description", input.description);
  form.set("reproducible", input.reproducible);
  if (input.screenshot) form.set("screenshot", input.screenshot, input.screenshot.name || "screenshot.png");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch("/api/v1/feedback", {
      method: "POST",
      body: form,
      signal: controller.signal,
      headers: { accept: "application/json", ...authHeaders() },
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ChatApiError("请求超时，请检查网络后重试。", 0, "TIMEOUT");
    }
    throw new ChatApiError("网络连接失败，请检查网络后重试。", 0, "NETWORK");
  } finally {
    window.clearTimeout(timer);
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as ErrorBody | null;
    throw new ChatApiError(
      data?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.requestId,
      data?.error?.hex,
    );
  }
  const payload = (await response.json()) as { report: FeedbackReport };
  return payload.report;
}

export async function fetchMyFeedback(): Promise<FeedbackReport[]> {
  const data = await requestJson<{ reports: FeedbackReport[] }>("/api/v1/feedback");
  return data.reports;
}

export async function deleteFile(id: string): Promise<void> {
  await fetch(`/api/v1/files/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
}

const RETRY_MAX_MESSAGES = 24;
const RETRY_MAX_CHARS = 80_000;

/** 只保留最近一段上下文，用于请求体过大/网络层无法建立连接时自动重试。 */
function trimMessagesForRetry(messages: ApiChatMessage[]): ApiChatMessage[] {
  const kept: ApiChatMessage[] = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (kept.length >= RETRY_MAX_MESSAGES) break;
    if (kept.length > 0 && chars + message.content.length > RETRY_MAX_CHARS) break;
    kept.unshift(message);
    chars += message.content.length;
  }
  const firstUser = kept.findIndex((message) => message.role === "user");
  return firstUser > 0 ? kept.slice(firstUser) : kept;
}

function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof ChatApiError) {
    return error.status === 0 || error.status === 413 || error.code === "PAYLOAD_TOO_LARGE";
  }
  if (error instanceof TypeError) return true;
  const message = ((error as Error)?.message ?? "").toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("network")
  );
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
  let received = false;
  const totalChars = options.messages.reduce((sum, message) => sum + message.content.length, 0);
  const prepared = totalChars > 800_000 ? trimMessagesForRetry(options.messages) : options.messages;
  if (prepared.length < options.messages.length) {
    console.warn("请求上下文过大，发送前自动丢弃较早消息", {
      before: options.messages.length,
      after: prepared.length,
      chars: totalChars,
    });
  }
  const tracked: StreamChatOptions = {
    ...options,
    messages: prepared,
    onDelta: (text) => {
      received = true;
      options.onDelta(text);
    },
    onReasoning: (text) => {
      received = true;
      options.onReasoning(text);
    },
    onSources: (sources) => {
      received = true;
      options.onSources?.(sources);
    },
    onRefusal: (text) => {
      received = true;
      options.onRefusal?.(text);
    },
  };

  try {
    await streamChatOnce(tracked);
  } catch (error) {
    if (received || !isRetryableNetworkError(error)) throw error;
    const trimmed = trimMessagesForRetry(prepared);
    if (trimmed.length >= prepared.length) throw error;
    console.warn("请求上下文过大，已自动丢弃较早消息并重试", {
      before: prepared.length,
      after: trimmed.length,
      reason: (error as Error)?.message,
    });
    await streamChatOnce({ ...tracked, messages: trimmed });
  }
}

async function streamChatOnce(options: StreamChatOptions): Promise<void> {
  const { messages, thinking, files, webSearch, signal, onStart, onSources, onDelta, onReasoning, onRefusal, onDone } = options;

  const encoded = await encodeJsonBody({ messages, thinking, files, webSearch });
  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...encoded.headers,
      ...authHeaders(),
    },
    body: encoded.body,
    signal,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as ErrorBody | null;
    throw new ChatApiError(
      data?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.requestId,
      data?.error?.hex,
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
      case "sources": {
        const sources = (data as { sources?: SearchSource[] }).sources;
        if (Array.isArray(sources)) onSources?.(sources);
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
        const error = (data as { error?: { code?: string; hex?: string; message?: string; requestId?: string } })
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
  const encoded = await encodeJsonBody({ messages });
  const response = await fetch("/api/v1/context/warm", {
    method: "POST",
    headers: { "content-type": "application/json", ...encoded.headers, ...authHeaders() },
    body: encoded.body,
  });
  if (!response.ok) {
    throw new ChatApiError("上下文预热失败", response.status, "WARM_FAILED");
  }
}


export interface ArchiveImportHandlers {
  onConversation?: (conversation: Conversation) => void | Promise<void>;
  onMessages?: (messages: Message[]) => void | Promise<void>;
  onProgress?: (progress: { conversations: number; messages: number }) => void;
}

export interface ArchiveImportResult {
  conversations: number;
  messages: number;
  skippedConversations: number;
  skippedMessages: number;
  attachments: number;
}

/** 让服务端流式下载并解压 DeepSeek 导出 ZIP，客户端按 NDJSON 分批落库。 */
export async function importArchiveFromUrl(
  url: string,
  skipIds: string[],
  handlers: ArchiveImportHandlers = {},
  signal?: AbortSignal,
): Promise<ArchiveImportResult> {
  const response = await fetch("/api/v1/import/archive", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ url, skipIds }),
    signal,
  });
  if (!response.ok) {
    let message = `导入失败（HTTP ${response.status}）`;
    let hex: string | undefined;
    let requestId: string | undefined;
    try {
      const payload = (await response.json()) as {
        error?: { message?: string; hex?: string; requestId?: string };
      };
      if (payload.error?.message) message = payload.error.message;
      hex = payload.error?.hex;
      requestId = payload.error?.requestId;
    } catch {
      // ignore
    }
    throw new ChatApiError(message, response.status, "IMPORT_FAILED", requestId, hex);
  }
  if (!response.body) throw new ChatApiError("导入响应为空", 502, "IMPORT_FAILED");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let conversions = 0;
  let messages = 0;
  let finalStats: ArchiveImportResult | null = null;

  const handleLine = async (line: string) => {
    if (!line.trim()) return;
    let payload: {
      type?: string;
      conversation?: Conversation;
      messages?: Message[];
      stats?: ArchiveImportResult;
      message?: string;
      hex?: string;
      requestId?: string;
      status?: number;
    };
    try {
      payload = JSON.parse(line) as typeof payload;
    } catch {
      return;
    }
    if (payload.type === "conversation" && payload.conversation) {
      await handlers.onConversation?.(payload.conversation);
      conversions += 1;
      handlers.onProgress?.({ conversations: conversions, messages });
    } else if (payload.type === "messages" && payload.messages) {
      await handlers.onMessages?.(payload.messages);
      messages += payload.messages.length;
      handlers.onProgress?.({ conversations: conversions, messages });
    } else if (payload.type === "done" && payload.stats) {
      finalStats = payload.stats;
    } else if (payload.type === "error") {
      throw new ChatApiError(
        payload.message ?? "导入过程中发生错误",
        payload.status ?? 502,
        "IMPORT_FAILED",
        payload.requestId,
        payload.hex,
      );
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        await handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) await handleLine(buffer);
  } finally {
    reader.releaseLock();
  }

  return (
    finalStats ?? {
      conversations: conversions,
      messages,
      skippedConversations: 0,
      skippedMessages: 0,
      attachments: 0,
    }
  );
}
