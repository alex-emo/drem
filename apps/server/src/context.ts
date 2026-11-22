import { createHash } from "node:crypto";
import { config } from "./config.js";
import { getContextSummary, putContextSummary } from "./db.js";
import type { ChatMessage } from "./deepseek.js";
import { ApiError } from "./protocol.js";
import { requestUpstreamJson } from "./deepseek.js";
import type { TokenUsage } from "./usage.js";

/**
 * 上下文压缩的算法目标：
 * 1. 以 token 估算而不是字符数为主，给上游留出输出/工具调用的空间；
 * 2. 摘要分段必须远小于模型上下文，避免“压缩请求本身超限”；
 * 3. 单段摘要失败时递归二分，仍失败则退化为抽取式摘要，绝不让整轮对话失败；
 * 4. 最近对话始终保留原文，摘要只覆盖较早历史。
 */

/** 触发压缩的估算 token 上限；Qwen 128k 上下文的保守值。 */
export const COMPRESS_TOKEN_THRESHOLD = 60_000;
export const COMPRESS_MESSAGE_THRESHOLD = 400;

/** 压缩后保留的最近原文。 */
const KEEP_RECENT_TOKENS = 20_000;
const KEEP_RECENT_MESSAGES = 120;

/** 每个摘要分段的上限，必须明显小于上下文上限。 */
const SEGMENT_MAX_TOKENS = 12_000;
const SEGMENT_MAX_MESSAGES = 120;
const SUMMARY_CONCURRENCY = 3;
const SUMMARY_MAX_TOKENS = 800;
const SUMMARY_CACHE_VERSION = 2;

const SUMMARY_PROMPT = `你是对话记录压缩器。请把下面这段对话压缩成不超过 800 字的中文摘要。要求：
1. 保留人物姓名/身份、关系、称呼与世界观设定；
2. 按时间顺序保留关键事件、承诺、情绪转折、伏笔和未完成的情节；
3. 保留重要的具体信息（地点、物品、时间、约定、数字）；
4. 不评论、不扩写、不遗漏会破坏后续剧情连续性的细节；
5. 直接输出摘要正文，不要标题、不要说明、不要提及“压缩”这件事。`;

export interface CompressionOutcome {
  messages: ChatMessage[];
  compressed: boolean;
  segments: number;
  cached: number;
  originalMessages: number;
  estimatedTokens: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * 轻量 token 估算：中文约 1 token/字，英文/代码约 3.5 字符/token。
 * 不引入 tokenizer 依赖，宁可高估也不低估，避免摘要请求再次超限。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk + other / 3.5);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0);
}

export function needsCompression(messages: ChatMessage[]): boolean {
  return (
    messages.length > COMPRESS_MESSAGE_THRESHOLD ||
    estimateMessagesTokens(messages) > COMPRESS_TOKEN_THRESHOLD
  );
}

function splitSegments(messages: ChatMessage[]): ChatMessage[][] {
  const segments: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let tokens = 0;

  for (const message of messages) {
    const messageTokens = estimateTokens(message.content) + 4;
    if (
      current.length > 0 &&
      (tokens + messageTokens > SEGMENT_MAX_TOKENS || current.length >= SEGMENT_MAX_MESSAGES)
    ) {
      segments.push(current);
      current = [];
      tokens = 0;
    }
    current.push(message);
    tokens += messageTokens;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function transcript(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const label =
        message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
      return `${label}：${message.content}`;
    })
    .join("\n\n");
}

function segmentKey(segment: ChatMessage[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: SUMMARY_CACHE_VERSION, segment }))
    .digest("hex");
}

async function summarizeOnce(
  segment: ChatMessage[],
  onUsage?: (usage: TokenUsage | null, keyId: number) => void,
): Promise<string> {
  const payload = {
    model: config.model,
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: transcript(segment) },
    ],
    stream: false,
    ...(config.provider === "qwen" ? { enable_thinking: false } : {}),
    temperature: 0.2,
    max_tokens: SUMMARY_MAX_TOKENS,
  };

  const result = await requestUpstreamJson(payload, 120_000);
  onUsage?.(result.usage, result.keyId);
  const data = result.data as ChatCompletionResponse;
  const summary = data.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new ApiError(502, "UPSTREAM_ERROR", "上游没有返回摘要");
  return summary;
}

/** 摘要失败时的抽取式兜底：保留每段末尾若干条消息的开头，至少不丢最近情节。 */
function extractiveSummary(segment: ChatMessage[]): string {
  const picked = segment.slice(-8);
  const lines = picked.map((message) => {
    const label = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
    const text = message.content.replace(/\s+/g, " ").slice(0, 220);
    return `${label}：${text}${message.content.length > 220 ? "…" : ""}`;
  });
  return `${lines.join("\n")}\n（此段因摘要服务失败，已按原文末尾抽取保留。）`;
}

/**
 * 单段摘要：先整段请求；若上游因上下文超限/参数拒绝，则二分递归；
 * 二分到单条仍失败时退化为抽取式摘要。不会抛错。
 */
async function summarizeSegmentSafe(
  segment: ChatMessage[],
  onUsage?: (usage: TokenUsage | null, keyId: number) => void,
  depth = 0,
): Promise<string> {
  try {
    return await summarizeOnce(segment, onUsage);
  } catch (error) {
    const message = (error as Error).message;
    console.warn(
      `[dream-server] context summary failed (depth ${depth}, ${segment.length} messages, ${estimateMessagesTokens(segment)} tokens): ${message}`,
    );
    if (depth >= 2 || segment.length <= 1) return extractiveSummary(segment);

    const middle = Math.ceil(segment.length / 2);
    const left = segment.slice(0, middle);
    const right = segment.slice(middle);
    const [leftSummary, rightSummary] = await Promise.all([
      summarizeSegmentSafe(left, onUsage, depth + 1),
      summarizeSegmentSafe(right, onUsage, depth + 1),
    ]);
    return `${leftSummary}\n\n${rightSummary}`;
  }
}

/**
 * 把过长的历史压成分段摘要，只保留最近一段原文。
 * 摘要按分段内容哈希缓存，追加新消息时旧分段不会重复计算。
 */
export async function compressContext(
  messages: ChatMessage[],
  options: { onUsage?: (usage: TokenUsage | null, keyId: number) => void } = {},
): Promise<CompressionOutcome> {
  const originalTokens = estimateMessagesTokens(messages);
  if (!needsCompression(messages)) {
    return {
      messages,
      compressed: false,
      segments: 0,
      cached: 0,
      originalMessages: messages.length,
      estimatedTokens: originalTokens,
    };
  }

  // 从尾部保留最近消息，直到达到 token/条数上限；至少保留最近 8 条。
  let cut = messages.length;
  let recentTokens = 0;
  let recentCount = 0;
  while (cut > 0 && recentCount < KEEP_RECENT_MESSAGES) {
    const messageTokens = estimateTokens(messages[cut - 1].content) + 4;
    if (recentCount >= 8 && recentTokens + messageTokens > KEEP_RECENT_TOKENS) break;
    recentTokens += messageTokens;
    recentCount += 1;
    cut -= 1;
  }

  const older = messages.slice(0, cut);
  const recent = messages.slice(cut);
  const segments = splitSegments(older);

  if (segments.length === 0) {
    return {
      messages,
      compressed: false,
      segments: 0,
      cached: 0,
      originalMessages: messages.length,
      estimatedTokens: originalTokens,
    };
  }

  const summaries: string[] = new Array(segments.length).fill("");
  let cached = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= segments.length) return;
      const segment = segments[index];
      const key = segmentKey(segment);
      const hit = getContextSummary(key);
      if (hit) {
        summaries[index] = hit;
        cached += 1;
        continue;
      }
      const summary = await summarizeSegmentSafe(segment, options.onUsage);
      putContextSummary(key, summary);
      summaries[index] = summary;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SUMMARY_CONCURRENCY, segments.length) }, () => worker()),
  );

  const header = `以下摘要按时间顺序概括了此前 ${older.length} 条对话。原始内容较长，已自动压缩为分段摘要；请保持人物设定、关系与情节连续，不要向用户提及“摘要”或“压缩”。`;
  const summaryBlock = `${header}\n\n${summaries
    .map((summary, index) => `【第 ${index + 1}/${segments.length} 段】\n${summary}`)
    .join("\n\n")}`;

  return {
    messages: [{ role: "system", content: summaryBlock }, ...recent],
    compressed: true,
    segments: segments.length,
    cached,
    originalMessages: messages.length,
    estimatedTokens: estimateMessagesTokens([{ role: "system", content: summaryBlock }, ...recent]),
  };
}
