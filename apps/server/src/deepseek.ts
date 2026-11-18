import { config } from "./config.js";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ParsedChatRequest {
  messages: ChatMessage[];
  thinking: boolean;
}

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

const MAX_MESSAGES = 100;
const MAX_CONTENT_LENGTH = 200_000;

/** 校验客户端传来的纯文本消息，返回可转发给上游的结构。 */
export function parseChatRequest(body: unknown): ParsedChatRequest {
  if (typeof body !== "object" || body === null) {
    throw new ChatRequestError("请求体必须是 JSON 对象");
  }
  const data = body as Record<string, unknown>;
  const thinking = data.thinking === true;

  if (!Array.isArray(data.messages) || data.messages.length === 0) {
    throw new ChatRequestError("messages 不能为空");
  }
  if (data.messages.length > MAX_MESSAGES) {
    throw new ChatRequestError(`消息数量超过上限（${MAX_MESSAGES} 条）`);
  }

  const messages: ChatMessage[] = data.messages.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new ChatRequestError(`messages[${index}] 格式不正确`);
    }
    const { role, content } = item as Record<string, unknown>;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new ChatRequestError(`messages[${index}].role 不合法`);
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new ChatRequestError(`messages[${index}].content 不能为空`);
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new ChatRequestError(`messages[${index}].content 超过长度上限`);
    }
    return { role, content };
  });

  if (!messages.some((m) => m.role === "user")) {
    throw new ChatRequestError("至少需要一条 user 消息");
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
 * 请求 DeepSeek chat/completions（stream=true），返回上游 SSE 流。
 * 客户端断开时通过 signal 中止上游请求。
 */
export async function proxyChatStream(
  parsed: ParsedChatRequest,
  clientSignal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (!config.apiKey) {
    throw new ChatRequestError("服务端未配置 DEEPSEEK_API_KEY", 503);
  }

  const upstreamController = new AbortController();
  const onClientAbort = () => upstreamController.abort(clientSignal.reason);
  if (clientSignal.aborted) onClientAbort();
  else clientSignal.addEventListener("abort", onClientAbort, { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: parsed.thinking ? config.reasonerModel : config.model,
        messages: parsed.messages,
        stream: true,
      }),
      signal: upstreamController.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ChatRequestError("客户端已断开连接", 499);
    }
    throw new ChatRequestError(`无法连接 DeepSeek API：${(err as Error).message}`, 502);
  }

  if (!upstream.ok) {
    const detail = extractErrorDetail(await upstream.text().catch(() => ""));
    if (upstream.status === 401) {
      throw new ChatRequestError(`DeepSeek API 鉴权失败（401）：${detail}`, 502);
    }
    throw new ChatRequestError(`DeepSeek API 返回 ${upstream.status}：${detail}`, 502);
  }

  if (!upstream.body) {
    throw new ChatRequestError("DeepSeek API 未返回流式响应体", 502);
  }

  const reader = upstream.body.getReader();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          try {
            controller.close();
          } catch {
            // 已被下游取消
          }
        } else {
          controller.error(err);
        }
      }
    },
    async cancel() {
      upstreamController.abort();
      await reader.cancel().catch(() => undefined);
    },
  });
}
