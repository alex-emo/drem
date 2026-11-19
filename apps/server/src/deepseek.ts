import { config } from "./config.js";
import { cooldownForStatus, isRetryableStatus, keyPool, type PooledKey } from "./keys.js";
import { ApiError } from "./protocol.js";
import { normalizeUsage, type TokenUsage } from "./usage.js";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ParsedChatRequest {
  messages: ChatMessage[];
  thinking: boolean;
}

const MAX_MESSAGES = 10_000;
const MAX_CONTENT_LENGTH = 200_000;

/** 校验客户端传来的纯文本消息，返回可转发给上游的结构。 */
export function parseChatRequest(
  body: unknown,
  options: { requireLastUser?: boolean } = {},
): ParsedChatRequest {
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
  if (options.requireLastUser !== false && messages[messages.length - 1]?.role !== "user") {
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

/** 把上游 HTTP 状态映射为 Dream 的错误码。 */
function mapUpstreamError(status: number, detail: string): ApiError {
  if (status === 401 || status === 403) {
    return new ApiError(
      502,
      "UPSTREAM_AUTH_FAILED",
      `${config.providerLabel} API 鉴权失败（${status}）：${detail}`,
    );
  }
  if (status === 402) {
    return new ApiError(502, "UPSTREAM_ERROR", `${config.providerLabel} API 余额不足（402）：${detail}`);
  }
  if (status === 429) {
    return new ApiError(429, "RATE_LIMITED", `${config.providerLabel} API 限流（429）：${detail}`);
  }
  if (status === 504) {
    return new ApiError(504, "UPSTREAM_TIMEOUT", `${config.providerLabel} API 超时（504）：${detail}`);
  }
  return new ApiError(502, "UPSTREAM_ERROR", `${config.providerLabel} API 返回 ${status}：${detail}`);
}

interface UpstreamResponse {
  response: Response;
  key: PooledKey;
}

/**
 * 从 Key 池里轮询取 Key 发请求：连接失败/鉴权失败/限流/5xx 会自动换下一个 Key。
 * 所有 Key 都失败时才抛错；400/404 这类请求本身的错误不重试。
 */
async function fetchUpstream(
  payload: Record<string, unknown>,
  clientSignal?: AbortSignal,
): Promise<UpstreamResponse> {
  if (keyPool.size === 0) {
    throw new ApiError(
      503,
      "UPSTREAM_NOT_CONFIGURED",
      `服务端未配置 ${config.keyEnv}：请在项目根目录创建 .env（参考 .env.example）并重启服务；或设置 DREAM_MOCK=1 使用本地模拟。`,
    );
  }

  const attempted = new Set<number>();
  let lastError: ApiError | null = null;

  for (;;) {
    const key = keyPool.acquire(attempted) ?? keyPool.acquireIgnoringCooldown(attempted);
    if (!key) break;
    attempted.add(key.id);

    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key.value}`,
        },
        body: JSON.stringify(payload),
        signal: clientSignal,
      });
    } catch (err) {
      const error = err as Error;
      if (clientSignal?.aborted || error.name === "AbortError") {
        throw new ApiError(499, "REQUEST_ABORTED", "客户端已断开连接");
      }
      if (error.name === "TimeoutError") {
        throw new ApiError(504, "UPSTREAM_TIMEOUT", `${config.providerLabel} API 请求超时`);
      }
      keyPool.markFailure(key, cooldownForStatus());
      lastError = new ApiError(
        502,
        "UPSTREAM_ERROR",
        `无法连接 ${config.providerLabel} API：${error.message}`,
      );
      console.warn(`[dream-server] upstream key #${key.id} network error: ${error.message}`);
      continue;
    }

    if (response.ok) {
      keyPool.markSuccess(key);
      return { response, key };
    }

    const detail = extractErrorDetail(await response.text().catch(() => ""));
    const mapped = mapUpstreamError(response.status, detail);
    if (!isRetryableStatus(response.status)) throw mapped;

    keyPool.markFailure(key, cooldownForStatus(response.status));
    lastError = mapped;
    console.warn(
      `[dream-server] upstream key #${key.id} failed (${response.status}), trying next key`,
    );
  }

  throw (
    lastError ??
    new ApiError(
      503,
      "UPSTREAM_NOT_CONFIGURED",
      `服务端没有可用的 ${config.keyEnv}：请配置至少一个密钥后重启服务。`,
    )
  );
}

export interface UpstreamJsonResult {
  data: unknown;
  keyId: number;
  usage: TokenUsage | null;
}

/** 非流式上游请求（摘要等），同样走 Key 池与重试。 */
export async function requestUpstreamJson(
  payload: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<UpstreamJsonResult> {
  const { response, key } = await fetchUpstream(payload, AbortSignal.timeout(timeoutMs));
  console.log(`[dream-server] upstream key #${key.id} served non-stream request`);
  const data = (await response.json()) as { usage?: unknown };
  return { data, keyId: key.id, usage: normalizeUsage(data.usage) };
}

/** 请求上游 chat/completions（stream=true），返回 SSE 字节流与所用 Key。 */
export async function openChatStream(
  parsed: ParsedChatRequest,
  clientSignal: AbortSignal,
): Promise<{ stream: ReadableStream<Uint8Array>; keyId: number }> {
  const payload =
    config.provider === "qwen"
      ? {
          model: config.model,
          messages: parsed.messages,
          stream: true,
          stream_options: { include_usage: true },
          enable_thinking: parsed.thinking,
        }
      : {
          model: parsed.thinking ? config.reasonerModel : config.model,
          messages: parsed.messages,
          stream: true,
          stream_options: { include_usage: true },
        };

  const { response: upstream, key } = await fetchUpstream(payload, clientSignal);
  if (!upstream.body) {
    throw new ApiError(502, "UPSTREAM_ERROR", `${config.providerLabel} API 未返回流式响应体`);
  }
  console.log(`[dream-server] upstream key #${key.id} served stream`);
  return { stream: upstream.body, keyId: key.id };
}
