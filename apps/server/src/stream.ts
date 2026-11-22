import { REFUSAL_MESSAGE, sseEncode } from "./protocol.js";
import { normalizeUsage, type TokenUsage } from "./usage.js";

export interface ChatStreamMeta {
  requestId: string;
  model: string;
  thinking: boolean;
}

type FinishReason = "stop" | "length" | "content_filter" | "unknown";

interface UpstreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

const KNOWN_FINISH_REASONS = new Set(["stop", "length", "content_filter"]);

/** 思考/正文都可能泄露底层模型名，统一替换成 Dream。 */
const THINKING_REPLACEMENTS: Array<[RegExp, string]> = [
  [/通义千问|通义|qwen|qianwen/gi, "Dream"],
  [/阿里云|阿里巴巴|阿里|alibaba(?:\s*cloud)?/gi, "Dream"],
  [/深度求索|deepseek/gi, "Dream"],
  [/anthropic|claude|openai|chatgpt|gpt-?4|google|gemini/gi, "Dream"],
  [/system\s*prompt|系统提示词?/gi, "设定"],
];

const SENSITIVE_TERMS = [
  "qwen",
  "qianwen",
  "通义千问",
  "通义",
  "阿里云",
  "阿里巴巴",
  "阿里",
  "alibaba",
  "deepseek",
  "深度求索",
  "anthropic",
  "claude",
  "openai",
  "chatgpt",
  "google",
  "gemini",
];

/** 找一个不会把敏感词切成两半的切点；找不到就返回 0，等更多文本再切。 */
function safeCut(buffer: string, desired: number): number {
  const lower = buffer.toLowerCase();
  for (let cut = Math.min(desired, buffer.length); cut > 0; cut -= 1) {
    const head = lower.slice(0, cut);
    const tail = lower.slice(cut, cut + 24);
    let unsafe = false;
    for (const term of SENSITIVE_TERMS) {
      if (term.length > tail.length + cut) continue;
      for (let k = 1; k < term.length; k += 1) {
        const prefix = term.slice(0, k);
        const suffix = term.slice(k);
        if (head.endsWith(prefix) && tail.startsWith(suffix)) {
          unsafe = true;
          break;
        }
      }
      if (unsafe) break;
    }
    if (!unsafe) return cut;
  }
  return 0;
}

export function redactOutput(text: string): string {
  let output = text;
  for (const [pattern, replacement] of THINKING_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  return output.replace(/Dream\s*\/\s*Dream/g, "Dream").replace(/Dream(?:\s+Dream)+/g, "Dream");
}

function parseFinishReason(raw: string | null | undefined): FinishReason {
  if (!raw) return "stop";
  return KNOWN_FINISH_REASONS.has(raw) ? (raw as FinishReason) : "unknown";
}

/** 从 SSE block 里提取 data 行（支持多行 data，忽略注释与其他字段）。 */
function extractData(block: string): string | null {
  const lines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (lines.length === 0) return null;
  const payload = lines.join("\n").trim();
  return payload || null;
}

type PendingEvent = { event: "thinking" | "delta"; text: string };

/**
 * 把上游 chat.completion.chunk 流归一化为 Dream 事件流：
 * start → (thinking | delta)* → done | error。
 *
 * 上游通常按句/大块到达，直接转发会让前端一阵一阵跳字。这里先把文本放进队列，
 * 固定 24ms 节拍按 backlog 自适应出字（伪流式），backlog 越大出字越快；
 * 全部出完后才发 done，保证客户端按顺序收尾。
 */
export function dreamChatStream(
  upstream: ReadableStream<Uint8Array>,
  meta: ChatStreamMeta,
  clientSignal?: AbortSignal,
  onFinish?: (info: { finishReason: FinishReason; usage: TokenUsage | null }) => void,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();

  let closed = false;
  let cancelled = false;
  let finished = false;
  let upstreamEnded = false;
  let finishReason: FinishReason = "stop";
  let usage: TokenUsage | null = null;

  let thinkingBuffer = "";
  let contentBuffer = "";
  const queue: PendingEvent[] = [];

  const pendingChars = (): number => queue.reduce((sum, item) => sum + item.text.length, 0);
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastActivityAt = Date.now();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (bytes: Uint8Array): boolean => {
        if (closed || cancelled) return false;
        try {
          controller.enqueue(bytes);
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      const emit = (event: string, data: unknown): boolean => safeEnqueue(sseEncode(event, data));

      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // 下游已取消
        }
      };

      let pump: ReturnType<typeof setInterval> | null = null;
      heartbeat = setInterval(() => {
        if (closed || cancelled) return;
        if (Date.now() - lastActivityAt > 120_000) {
          finish("error", {
            error: {
              code: "STREAM_TIMEOUT",
              message: "生成超时，请稍后重试。",
              requestId: meta.requestId,
            },
          });
          return;
        }
        safeEnqueue(new TextEncoder().encode(": ping\n\n"));
      }, 15000);

      const stopPump = (): void => {
        if (pump) {
          clearInterval(pump);
          pump = null;
        }
      };

      const finish = (event: "done" | "error", data: unknown): void => {
        stopPump();
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        emit(event, data);
        close();
        if (!finished) {
          finished = true;
          try {
            onFinish?.({ finishReason, usage });
          } catch (error) {
            console.warn(`[dream-server] onFinish callback failed: ${(error as Error).message}`);
          }
        }
        void reader.cancel().catch(() => undefined);
      };

      const finishDone = (): void => {
        finish("done", {
          requestId: meta.requestId,
          finishReason,
          createdAt: new Date().toISOString(),
        });
      };

      const enqueue = (event: "thinking" | "delta", text: string): void => {
        if (!text) return;
        queue.push({ event, text });
        ensurePump();
      };

      const pumpOnce = (): void => {
        if (closed || cancelled) {
          stopPump();
          return;
        }
        const head = queue[0];
        if (!head) {
          if (upstreamEnded) finishDone();
          else stopPump();
          return;
        }

        const backlog = pendingChars();
        const speed =
          head.event === "thinking"
            ? backlog > 4000
              ? 72
              : backlog > 1500
                ? 28
                : 10
            : backlog > 6000
              ? 64
              : backlog > 2500
                ? 28
                : backlog > 800
                  ? 12
                  : 5;
        const take = Math.min(head.text.length, speed);
        const piece = head.text.slice(0, take);
        head.text = head.text.slice(take);
        if (!head.text) queue.shift();
        emit(head.event, { delta: piece });
      };

      function ensurePump(): void {
        if (pump || closed || cancelled) return;
        pump = setInterval(pumpOnce, 32);
      }

      const flushBuffer = (kind: "thinking" | "delta", final: boolean): void => {
        const buffer = kind === "thinking" ? thinkingBuffer : contentBuffer;
        if (!buffer) return;
        const hold = 12;
        if (!final && buffer.length <= hold + 4) return;
        const cut = final ? buffer.length : safeCut(buffer, buffer.length - hold);
        if (cut <= 0) return;
        const text = buffer.slice(0, cut);
        if (kind === "thinking") thinkingBuffer = buffer.slice(cut);
        else contentBuffer = buffer.slice(cut);
        enqueue(kind, redactOutput(text));
      };

      const onAbort = (): void => {
        cancelled = true;
        queue.length = 0;
        stopPump();
        close();
        void reader.cancel().catch(() => undefined);
      };

      if (clientSignal) {
        if (clientSignal.aborted) onAbort();
        else clientSignal.addEventListener("abort", onAbort, { once: true });
      }

      emit("start", {
        requestId: meta.requestId,
        model: meta.model,
        thinking: meta.thinking,
        createdAt: new Date().toISOString(),
      });

      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) break;
          lastActivityAt = Date.now();

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            const payload = extractData(block);
            if (!payload) continue;
            if (payload === "[DONE]") {
              upstreamEnded = true;
              break;
            }

            const chunk = JSON.parse(payload) as UpstreamChunk;
            const parsedUsage = normalizeUsage(chunk.usage);
            if (parsedUsage) usage = parsedUsage;
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;

            if (typeof delta?.reasoning_content === "string" && delta.reasoning_content) {
              thinkingBuffer += delta.reasoning_content;
              flushBuffer("thinking", false);
            }
            if (typeof delta?.content === "string" && delta.content) {
              flushBuffer("thinking", true);
              contentBuffer += delta.content;
              flushBuffer("delta", false);
            }
            if (choice?.finish_reason) {
              finishReason = parseFinishReason(choice.finish_reason);
            }
          }
          if (upstreamEnded) break;
        }

        if (cancelled) return;
        flushBuffer("thinking", true);
        flushBuffer("delta", true);
        upstreamEnded = true;
        if (queue.length === 0) finishDone();
        else ensurePump();
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") {
          close();
          return;
        }
        console.error(`[dream-server] ${meta.requestId} upstream stream error`, err);
        finish("error", {
          error: {
            code: "UPSTREAM_ERROR",
            message: "生成过程中连接中断，请稍后重试。",
            requestId: meta.requestId,
          },
        });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (clientSignal) clientSignal.removeEventListener("abort", onAbort);
        try {
          reader.releaseLock();
        } catch {
          // 忽略：读取仍在进行时无法释放
        }
      }
    },
    cancel() {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      queue.length = 0;
      void reader.cancel().catch(() => undefined);
    },
  });
}

/** 内容安全拒绝：不返回上游错误，按 DeepSeek 客户端的方式返回固定答复。 */
export function refusalStream(meta: ChatStreamMeta): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const createdAt = new Date().toISOString();
      controller.enqueue(
        sseEncode("start", {
          requestId: meta.requestId,
          model: meta.model,
          thinking: meta.thinking,
          createdAt,
        }),
      );
      controller.enqueue(
        sseEncode("refusal", {
          requestId: meta.requestId,
          model: meta.model,
          message: REFUSAL_MESSAGE,
        }),
      );
      controller.enqueue(
        sseEncode("done", {
          requestId: meta.requestId,
          finishReason: "content_filter",
          createdAt,
        }),
      );
      controller.close();
    },
  });
}
