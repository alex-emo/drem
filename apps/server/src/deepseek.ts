import { config } from "./config.js";
import { ApiError } from "./protocol.js";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ParsedChatRequest {
  messages: ChatMessage[];
  thinking: boolean;
}

const MAX_MESSAGES = 100;
const MAX_CONTENT_LENGTH = 200_000;

/** 校验客户端传来的纯文本消息，返回可转发给上游的结构。 */
export function parseChatRequest(body: unknown): ParsedChatRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_ARGUMENT", "请求体必须是 JSON 对象");
  }

  const data = body as Record<string, unknown>;

  if (data.thinking !== undefined && typeof data.thinking !== "boolean") {
    throw new ApiError(400, "INVALID_ARGUMENT", "thinking 必须是布尔值", [
      { field: "thinking", reason: "type" },
    ]);
  }
  const thinking = data.thinking === true;

  if (!Array.isArray(data.messages) || data.messages.length === 0) {
    throw new ApiError(400, "INVALID_ARGUMENT", "messages 不能为空", [
      { field: "messages", reason: "至少需要一条消息" },
    ]);
  }
  if (data.messages.length > MAX_MESSAGES) {
    throw new ApiError(400, "INVALID_ARGUMENT", `消息数量超过上限（${MAX_MESSAGES} 条）`, [
      { field: "messages", reason: "too_many" },
    ]);
  }

  const messages: ChatMessage[] = data.messages.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new ApiError(400, "INVALID_ARGUMENT", `messages[${index}] 格式不正确`, [
        { field: `messages[${index}]`, reason: "type" },
      ]);
    }
    const { role, content } = item as Record<string, unknown>;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new ApiError(400, "INVALID_ARGUMENT", `messages[${index}].role 不合法`, [
        { field: `messages[${index}].role`, reason: "enum" },
      ]);
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new ApiError(400, "INVALID_ARGUMENT", `messages[${index}].content 不能为空`, [
        { field: `messages[${index}].content`, reason: "required" },
      ]);
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new ApiError(400, "INVALID_ARGUMENT", `messages[${index}].content 超过长度上限`, [
        { field: `messages[${index}].content`, reason: "too_long" },
      ]);
    }
    return { role, content };
  });

  if (!messages.some((message) => message.role === "user")) {
    throw new ApiError(400, "INVALID_ARGUMENT", "至少需要一条 user 消息", [
      { field: "messages", reason: "missing_user" },
    ]);
  }
  if (messages[messages.length - 1]?.role !== "user") {
    throw new ApiError(400, "INVALID_ARGUMENT", "最后一条消息必须是 user", [
      { field: "messages", reason: "last_must_be_user" },
    ]);
  }

  return { messages, thinking };
}

function extractErrorDetail(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {
    // 非 JSON，直接截断原文
  }
  return raw.slice(0, 500) || "上游未返回错误详情";
}

/**
 * 请求 DeepSeek chat/completions（stream=true），返回上游 SSE 字节流。
 * 客户端断开时通过 signal 中止上游请求。
 */
export async function openChatStream(
  parsed: ParsedChatRequest,
  clientSignal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (!config.apiKey) {
    throw new ApiError(
      503,
      "UPSTREAM_NOT_CONFIGURED",
      `服务端未配置 ${config.keyEnv}：请在项目根目录创建 .env（参考 .env.example）并重启服务；或设置 DREAM_MOCK=1 使用本地模拟。`,
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(
        config.provider === "qwen"
          ? {
              model: config.model,
              messages: parsed.messages,
              stream: true,
              enable_thinking: parsed.thinking,
            }
          : {
              model: parsed.thinking ? config.reasonerModel : config.model,
              messages: parsed.messages,
              stream: true,
            },
      ),
      signal: clientSignal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ApiError(499, "REQUEST_ABORTED", "客户端已断开连接");
    }
    throw new ApiError(502, "UPSTREAM_ERROR", `无法连接 ${config.providerLabel} API：${(err as Error).message}`);
  }

  if (!upstream.ok) {
    const detail = extractErrorDetail(await upstream.text().catch(() => ""));
    if (upstream.status === 401) {
      throw new ApiError(502, "UPSTREAM_AUTH_FAILED", `${config.providerLabel} API 鉴权失败（401）：${detail}`);
    }
    if (upstream.status === 429) {
      throw new ApiError(429, "RATE_LIMITED", `${config.providerLabel} API 限流（429）：${detail}`);
    }
    if (upstream.status === 504) {
      throw new ApiError(504, "UPSTREAM_TIMEOUT", `${config.providerLabel} API 超时（504）：${detail}`);
    }
    throw new ApiError(502, "UPSTREAM_ERROR", `${config.providerLabel} API 返回 ${upstream.status}：${detail}`);
  }

  if (!upstream.body) {
    throw new ApiError(502, "UPSTREAM_ERROR", `${config.providerLabel} API 未返回流式响应体`);
  }

  return upstream.body;
}
