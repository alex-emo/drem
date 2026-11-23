import { config } from "./config.js";
import { isContextLengthError } from "./deepseek.js";
import { withDreamIdentity } from "./identity.js";
import { getModelSettings } from "./settings.js";
import { cooldownForStatus, isRetryableStatus, keyPool, type PooledKey } from "./keys.js";
import { ApiError, errorHex, sseEncode, userErrorMessage } from "./protocol.js";
import { redactOutput } from "./stream.js";
import { normalizeUsage, type TokenUsage } from "./usage.js";

export interface SearchSource {
  index: number;
  title: string;
  url: string;
  siteName?: string;
  icon?: string;
}

interface ChatMessageLike {
  role: "system" | "user" | "assistant";
  content: string;
}

const SEARCH_TIMEOUT_MS = 90_000;

function searchEndpoint(): string {
  const base = config.baseUrl.replace(/\/compatible-mode\/v1\/?$/, "").replace(/\/$/, "");
  return `${base}/api/v1/services/aigc/multimodal-generation/generation`;
}

function buildPayload(messages: ChatMessageLike[], thinking: boolean) {
  const prepared = withDreamIdentity(messages).map((message) => ({
    role: message.role,
    content: [{ text: message.content }],
  }));
  return {
    model: config.model,
    input: { messages: prepared },
    parameters: {
      enable_search: true,
      search_options: {
        forced_search: true,
        enable_source: true,
        enable_citation: true,
        search_strategy: "turbo",
      },
      enable_thinking: thinking,
      incremental_output: true,
      stream: true,
      temperature: getModelSettings().temperature,
    },
  };
}

async function fetchSearch(
  payload: unknown,
  signal: AbortSignal,
): Promise<{ response: Response; key: PooledKey }> {
  const tried = new Set<number>();
  let lastError: ApiError | null = null;
  for (let attempt = 0; attempt < Math.max(1, keyPool.total); attempt += 1) {
    const key = keyPool.acquire(tried) ?? keyPool.acquireIgnoringCooldown(tried);
    if (!key) break;
    tried.add(key.id);
    try {
      const response = await fetch(searchEndpoint(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.value}`,
          "content-type": "application/json",
          "X-DashScope-SSE": "enable",
        },
        body: JSON.stringify(payload),
        signal,
      });
      if (response.ok) {
        keyPool.markSuccess(key);
        return { response, key };
      }
      const detail = (await response.text()).slice(0, 600);
      if (response.status === 400 && isContextLengthError(detail)) {
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", `联网搜索上下文超出上限，请缩短对话后重试：${detail}`);
      }
      if (isRetryableStatus(response.status)) {
        keyPool.markFailure(key, cooldownForStatus(response.status));
        lastError = new ApiError(502, "UPSTREAM_ERROR", `联网搜索上游返回 ${response.status}：${detail}`);
        continue;
      }
      throw new ApiError(502, "UPSTREAM_ERROR", `联网搜索上游返回 ${response.status}：${detail}`);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new ApiError(499, "REQUEST_ABORTED", "请求已取消");
      }
      if (error instanceof ApiError) throw error;
      keyPool.markFailure(key, 30_000);
      lastError = new ApiError(502, "UPSTREAM_ERROR", `联网搜索上游不可达：${(error as Error).message}`);
    }
  }
  throw lastError ?? new ApiError(503, "UPSTREAM_NOT_CONFIGURED", "没有可用的联网搜索 Key");
}

interface SearchEvent {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ text?: string }>;
        reasoning_content?: string;
      };
      finish_reason?: string | null;
    }>;
    search_info?: { search_results?: Array<Record<string, unknown>> };
  };
  usage?: Record<string, unknown>;
}

function mapSources(raw: Array<Record<string, unknown>>): SearchSource[] {
  return raw
    .map((item, index) => ({
      index: typeof item.index === "number" ? item.index : index + 1,
      title: String(item.title ?? "未命名来源"),
      url: String(item.url ?? ""),
      siteName: typeof item.site_name === "string" ? item.site_name : undefined,
      icon: typeof item.icon === "string" ? item.icon : undefined,
    }))
    .filter((item) => item.url.startsWith("http"));
}

export interface SearchStreamMeta {
  requestId: string;
  model: string;
  thinking: boolean;
}

/** 联网搜索：走 DashScope 多模态端点，输出 start → sources → thinking/delta → done。 */
export async function openSearchStream(
  messages: ChatMessageLike[],
  meta: SearchStreamMeta,
  clientSignal: AbortSignal,
  onFinish: (result: { usage: TokenUsage | null; keyId: number }) => void,
): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  clientSignal.addEventListener("abort", onAbort, { once: true });

  const { response, key } = await fetchSearch(buildPayload(messages, meta.thinking), controller.signal);
  if (!response.body) {
    clearTimeout(timer);
    throw new ApiError(502, "UPSTREAM_ERROR", "联网搜索未返回流式响应体");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let sourcesSent = false;
  let sentText = "";
  let sentReasoning = "";
  let finishReason = "stop";
  let usage: TokenUsage | null = null;
  let closed = false;


  return new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(sseEncode("start", { requestId: meta.requestId, model: meta.model, thinking: meta.thinking, createdAt: new Date().toISOString() }));
      const reader = response.body!.getReader();

      const pump = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let index = buffer.indexOf("\n\n");
            while (index >= 0) {
              const block = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);
              index = buffer.indexOf("\n\n");
              const data = block
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("");
              if (!data) continue;
              let parsed: SearchEvent;
              try {
                parsed = JSON.parse(data) as SearchEvent;
              } catch {
                continue;
              }
              const choice = parsed.output?.choices?.[0];
              const message = choice?.message;
              if (!sourcesSent) {
                const raw = parsed.output?.search_info?.search_results;
                if (Array.isArray(raw) && raw.length > 0) {
                  sourcesSent = true;
                  streamController.enqueue(sseEncode("sources", { sources: mapSources(raw) }));
                }
              }
              const reasoning = message?.reasoning_content ?? "";
              if (reasoning.startsWith(sentReasoning)) {
                const delta = redactOutput(reasoning.slice(sentReasoning.length));
                sentReasoning = reasoning;
                if (delta) streamController.enqueue(sseEncode("thinking", { delta }));
              } else if (reasoning && !sentReasoning.startsWith(reasoning)) {
                const delta = redactOutput(reasoning);
                sentReasoning += reasoning;
                if (delta) streamController.enqueue(sseEncode("thinking", { delta }));
              }
              const texts = (message?.content ?? []).map((part) => part.text ?? "").join("");
              if (texts.startsWith(sentText)) {
                const delta = redactOutput(texts.slice(sentText.length));
                sentText = texts;
                if (delta) streamController.enqueue(sseEncode("delta", { delta }));
              } else if (texts && !sentText.startsWith(texts)) {
                const delta = redactOutput(texts);
                sentText += texts;
                if (delta) streamController.enqueue(sseEncode("delta", { delta }));
              }
              if (choice?.finish_reason && choice.finish_reason !== "null") finishReason = choice.finish_reason;
              if (parsed.usage) usage = normalizeUsage(parsed.usage);
            }
          }
          if (!closed) {
            closed = true;
            streamController.enqueue(sseEncode("done", { requestId: meta.requestId, finishReason: finishReason === "stop" ? "stop" : "stop", createdAt: new Date().toISOString() }));
            onFinish({ usage, keyId: key.id });
            streamController.close();
          }
        } catch (error) {
          if (!closed) {
            closed = true;
            const aborted = (error as Error).name === "AbortError";
            console.warn(
              `[dream-server] ${meta.requestId} search stream failed: ${(error as Error).message}`,
            );
            streamController.enqueue(
              sseEncode("error", {
                code: "UPSTREAM_ERROR",
                hex: errorHex("UPSTREAM_ERROR"),
                message: aborted ? "联网搜索已取消。" : userErrorMessage("UPSTREAM_ERROR"),
                requestId: meta.requestId,
              }),
            );
            streamController.close();
          }
        } finally {
          clearTimeout(timer);
          clientSignal.removeEventListener("abort", onAbort);
        }
      };
      void pump();
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
      clientSignal.removeEventListener("abort", onAbort);
      controller.abort();
    },
  });
}
