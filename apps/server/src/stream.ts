import { sseEncode } from "./protocol.js";

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
}

const KNOWN_FINISH_REASONS = new Set(["stop", "length", "content_filter"]);

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

/**
 * 把 DeepSeek 的 chat.completion.chunk 流归一化为 Dream 事件流：
 * start → (thinking | delta)* → done | error
 */
export function dreamChatStream(
  upstream: ReadableStream<Uint8Array>,
  meta: ChatStreamMeta,
  clientSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();

  let closed = false;
  let cancelled = false;
  let finishReason: FinishReason = "stop";

  const safeEnqueue = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    bytes: Uint8Array,
  ): boolean => {
    if (closed || cancelled) return false;
    try {
      controller.enqueue(bytes);
      return true;
    } catch {
      closed = true;
      return false;
    }
  };

  const emit = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown,
  ) => safeEnqueue(controller, sseEncode(event, data));

  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    try {
      controller.close();
    } catch {
      // 下游已取消
    }
  };

  const finish = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: "done" | "error",
    data: unknown,
  ) => {
    emit(controller, event, data);
    close(controller);
    // 结束事件发出后立即释放上游连接，避免上游不主动断开导致客户端挂到超时。
    void reader.cancel().catch(() => undefined);
  };

  const onAbort = () => {
    cancelled = true;
    void reader.cancel().catch(() => undefined);
  };
  if (clientSignal) {
    if (clientSignal.aborted) onAbort();
    else clientSignal.addEventListener("abort", onAbort, { once: true });
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      emit(controller, "start", {
        requestId: meta.requestId,
        model: meta.model,
        thinking: meta.thinking,
        createdAt: new Date().toISOString(),
      });

      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (cancelled) {
            close(controller);
            return;
          }
          if (done) break;

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            const payload = extractData(block);
            if (!payload) continue;
            if (payload === "[DONE]") {
              finish(controller, "done", {
                requestId: meta.requestId,
                finishReason,
                createdAt: new Date().toISOString(),
              });
              return;
            }

            const chunk = JSON.parse(payload) as UpstreamChunk;
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;

            if (typeof delta?.reasoning_content === "string" && delta.reasoning_content) {
              emit(controller, "thinking", { delta: delta.reasoning_content });
            }
            if (typeof delta?.content === "string" && delta.content) {
              emit(controller, "delta", { delta: delta.content });
            }
            if (choice?.finish_reason) {
              finishReason = parseFinishReason(choice.finish_reason);
            }
          }
        }

        if (cancelled) {
          close(controller);
          return;
        }
        // 上游未发送 [DONE] 正常关闭时，补一个 done，保证客户端总能收尾。
        finish(controller, "done", {
          requestId: meta.requestId,
          finishReason,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") {
          close(controller);
          return;
        }
        console.error(`[dream-server] ${meta.requestId} upstream stream error`, err);
        finish(controller, "error", {
          error: {
            code: "UPSTREAM_ERROR",
            message: "生成过程中连接中断，请稍后重试。",
            requestId: meta.requestId,
          },
        });
      } finally {
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
      void reader.cancel().catch(() => undefined);
    },
  });
}
