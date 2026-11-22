import { config } from "./config.js";
import { withDreamIdentity } from "./identity.js";
import {
  cooldownForStatus,
  isRetryableStatus,
  keyPool,
  type KeyPool,
  type PooledKey,
} from "./keys.js";
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
  webSearch: boolean;
  files: string[];
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
  if (data.webSearch !== undefined && typeof data.webSearch !== "boolean") {
    throw new ApiError(400, "INVALID_ARGUMENT", "webSearch 必须是布尔值", [
      { field: "webSearch", reason: "type" },
    ]);
  }
  const webSearch = data.webSearch === true;
  let files: string[] = [];
  if (data.files !== undefined) {
    if (!Array.isArray(data.files) || data.files.some((item) => typeof item !== "string" || !item.trim())) {
      throw new ApiError(400, "INVALID_ARGUMENT", "files 必须是文件 id 数组", [
        { field: "files", reason: "type" },
      ]);
    }
    files = [...new Set(data.files as string[])];
    if (files.length > 8) {
      throw new ApiError(400, "INVALID_ARGUMENT", "一次最多引用 8 个文件", [
        { field: "files", reason: "too_many" },
      ]);
    }
  }

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

  return { messages, thinking, webSearch, files };
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

/** 上游上下文超限：不同供应商的 400 文案不一致，统一映射为 413，客户端会裁剪后重试。 */
export function isContextLengthError(detail: string): boolean {
  return /context length|context_length|maximum context|too many tokens|input is too long|token limit|超出.{0,6}(?:长度|上限)|上下文.{0,6}(?:过长|超限|上限)/i.test(
    detail,
  );
}

/** 上游内容安全拦截：Qwen 以 400 DataInspectionFailed 返回，需要区别于普通参数错误。 */
function isContentFilterError(status: number, detail: string): boolean {
  return (
    status === 400 &&
    /DataInspectionFailed|inappropriate content|content (?:inspection|filter)|安全策略/i.test(detail)
  );
}

/** 把上游 HTTP 状态映射为 Dream 的错误码。 */
function mapUpstreamError(status: number, detail: string, label: string): ApiError {
  if (status === 400 && isContextLengthError(detail)) {
    return new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      `${label} 的上下文超出上限，请缩短最近的对话后重试：${detail}`,
    );
  }
  if (isContentFilterError(status, detail)) {
    return new ApiError(
      422,
      "CONTENT_FILTERED",
      `${label} 的内容安全策略拒绝了这段对话：${detail}`,
    );
  }
  if (status === 401 || status === 403) {
    return new ApiError(
      502,
      "UPSTREAM_AUTH_FAILED",
      `${label} API 鉴权失败（${status}）：${detail}`,
    );
  }
  if (status === 402) {
    return new ApiError(502, "UPSTREAM_ERROR", `${label} API 余额不足（402）：${detail}`);
  }
  if (status === 429) {
    return new ApiError(429, "RATE_LIMITED", `${label} API 限流（429）：${detail}`);
  }
  if (status === 504) {
    return new ApiError(504, "UPSTREAM_TIMEOUT", `${label} API 超时（504）：${detail}`);
  }
  return new ApiError(502, "UPSTREAM_ERROR", `${label} API 返回 ${status}：${detail}`);
}

interface UpstreamResponse {
  response: Response;
  key: PooledKey;
}

interface UpstreamTarget {
  pool: KeyPool;
  baseUrl: string;
  label: string;
  keyEnv: string;
}

const primaryTarget: UpstreamTarget = {
  pool: keyPool,
  baseUrl: config.baseUrl,
  label: config.providerLabel,
  keyEnv: config.keyEnv,
};

/**
 * 从 Key 池里轮询取 Key 发请求：连接失败/鉴权失败/限流/5xx 会自动换下一个 Key。
 * 所有 Key 都失败时才抛错；400/404 这类请求本身的错误不重试。
 */
async function fetchUpstream(
  target: UpstreamTarget,
  payload: Record<string, unknown>,
  clientSignal?: AbortSignal,
): Promise<UpstreamResponse> {
  if (target.pool.size === 0) {
    throw new ApiError(
      503,
      "UPSTREAM_NOT_CONFIGURED",
      `服务端未配置 ${target.keyEnv}：请在项目根目录创建 .env（参考 .env.example）并重启服务；或设置 DREAM_MOCK=1 使用本地模拟。`,
    );
  }

  const attempted = new Set<number>();
  let lastError: ApiError | null = null;

  for (;;) {
    const key = target.pool.acquire(attempted) ?? target.pool.acquireIgnoringCooldown(attempted);
    if (!key) break;
    attempted.add(key.id);

    let response: Response;
    try {
      response = await fetch(`${target.baseUrl}/chat/completions`, {
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
        throw new ApiError(504, "UPSTREAM_TIMEOUT", `${target.label} API 请求超时`);
      }
      target.pool.markFailure(key, cooldownForStatus());
      lastError = new ApiError(
        502,
        "UPSTREAM_ERROR",
        `无法连接 ${target.label} API：${error.message}`,
      );
      console.warn(`[dream-server] upstream key #${key.id} network error: ${error.message}`);
      continue;
    }

    if (response.ok) {
      target.pool.markSuccess(key);
      return { response, key };
    }

    const detail = extractErrorDetail(await response.text().catch(() => ""));
    const mapped = mapUpstreamError(response.status, detail, target.label);
    if (!isRetryableStatus(response.status)) throw mapped;

    target.pool.markFailure(key, cooldownForStatus(response.status));
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
      `服务端没有可用的 ${target.keyEnv}：请配置至少一个密钥后重启服务。`,
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
  const { response, key } = await fetchUpstream(primaryTarget, payload, AbortSignal.timeout(timeoutMs));
  console.log(`[dream-server] upstream key #${key.id} served non-stream request`);
  const data = (await response.json()) as { usage?: unknown };
  return { data, keyId: key.id, usage: normalizeUsage(data.usage) };
}

/** 请求上游 chat/completions（stream=true），返回 SSE 字节流与所用 Key。 */
export async function openChatStream(
  parsed: ParsedChatRequest,
  clientSignal: AbortSignal,
): Promise<{
  stream: ReadableStream<Uint8Array>;
  keyId: number;
  model: string;
  provider: "deepseek" | "qwen";
}> {
  const payload =
    config.provider === "qwen"
      ? {
          model: config.model,
          messages: withDreamIdentity(parsed.messages),
          stream: true,
          stream_options: { include_usage: true },
          enable_thinking: parsed.thinking,
        }
      : {
          model: parsed.thinking ? config.reasonerModel : config.model,
          messages: withDreamIdentity(parsed.messages),
          stream: true,
          stream_options: { include_usage: true },
        };

  const result = await fetchUpstream(primaryTarget, payload, clientSignal);
  const servedModel =
    config.provider === "qwen"
      ? config.model
      : parsed.thinking
        ? config.reasonerModel
        : config.model;

  const upstream = result.response;
  if (!upstream.body) {
    throw new ApiError(502, "UPSTREAM_ERROR", `${config.providerLabel} API 未返回流式响应体`);
  }
  console.log(`[dream-server] upstream key #${result.key.id} served stream`);
  return {
    stream: upstream.body,
    keyId: result.key.id,
    model: servedModel,
    provider: config.provider,
  };
}
