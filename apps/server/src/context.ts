import { createHash } from "node:crypto";
import { config } from "./config.js";
import { getContextSummary, putContextSummary } from "./db.js";
import type { ChatMessage } from "./deepseek.js";
import { ApiError } from "./protocol.js";
import { requestUpstreamJson } from "./deepseek.js";
import type { TokenUsage } from "./usage.js";

/**
 * 上下文压缩 v3：在 v2 的“分段摘要 + 最近原文”之上增加三层约束：
 *
 * 1. 单条消息先裁剪，避免一条 200k 字符的消息或附件把压缩请求本身撑爆；
 * 2. 摘要块有总 token 预算，超出后对摘要再做递归归并，而不是无限拼接；
 * 3. 摘要采用结构化提纲（目标/事实/决定/进度），比自由散文更利于后续任务。
 *
 * 这套做法对应业界常说的 compaction + bounded summary tree：
 * 先压缩，再保证压缩产物本身不超过预算。
 */

/** 触发压缩的估算 token 上限；Qwen 128k 上下文的保守值。 */
export const COMPRESS_TOKEN_THRESHOLD = 60_000;
export const COMPRESS_MESSAGE_THRESHOLD = 400;
/** 压缩后的硬预算，给上游输出留出空间。 */
export const CONTEXT_TOKEN_LIMIT = 96_000;

/** 压缩后保留的最近原文。 */
const KEEP_RECENT_TOKENS = 24_000;
const KEEP_RECENT_MESSAGES = 160;

/** 单条消息进入上下文前的上限；最后一条用户消息保留更多原文。 */
const MAX_HISTORY_MESSAGE_TOKENS = 6_000;
const MAX_LAST_MESSAGE_TOKENS = 12_000;

/** 每个摘要分段的上限，必须明显小于上下文上限。 */
const SEGMENT_MAX_TOKENS = 12_000;
const SEGMENT_MAX_MESSAGES = 120;
const SUMMARY_CONCURRENCY = 3;
const SUMMARY_MAX_TOKENS = 700;
/** 摘要块总预算：最近原文 24k + 摘要 10k，远低于 96k 硬预算。 */
const SUMMARY_BUDGET_TOKENS = 10_000;
const SUMMARY_CACHE_VERSION = 3;

const SUMMARY_PROMPT = `你是对话记录压缩器。把下面这段对话压缩成不超过 700 字的结构化中文摘要，供后续对话继续使用。请严格按以下小标题输出，没有内容就写“无”：

【目标与约束】用户正在做什么、明确要求、禁止事项、风格/格式约束。
【关键事实】人物姓名/身份/关系、项目/代码/报错、地点/物品/时间/数字、已确认的结论。
【决定与原因】已经做出的选择，以及为什么这样选。
【进度与待办】已完成、进行中、未完成、下一步。
【重要上下文】继续对话必须记住的设定、术语、承诺或伏笔。

要求：
1. 代码标识、文件路径、报错原文保持原样，不要改写；
2. 不要评论、不要扩写、不要编造；
3. 直接输出摘要正文，不要提及“压缩”“摘要”这件事。`;

/** 超过 100 条时，把最前面 50 条压成一条摘要，避免上下文无限增长。 */
export const LEAD_COMPACT_TRIGGER = 100;
export const LEAD_COMPACT_COUNT = 50;
/** 内容审核拒绝时，优先压缩最前面 70 条再重试。 */
export const FILTER_COMPACT_COUNT = 70;

export interface LeadingCompaction {
  messages: ChatMessage[];
  compacted: boolean;
  summaryTokens: number;
}

export interface CompressionOutcome {
  messages: ChatMessage[];
  compressed: boolean;
  segments: number;
  cached: number;
  originalMessages: number;
  estimatedTokens: number;
  /** 因单条过长而被裁剪的消息数。 */
  clippedMessages: number;
  /** 摘要块最终占用的估算 token。 */
  summaryTokens: number;
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

/** 保留头尾、裁掉中段；用于超长单条消息和超大附件文本。 */
export function clipText(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const charsPerToken = text.length / Math.max(1, estimateTokens(text));
  const maxChars = Math.max(400, Math.floor(maxTokens * charsPerToken));
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.max(120, maxChars - head);
  const removed = text.length - head - tail;
  return `${text.slice(0, head)}\n…[中间内容已省略 ${removed} 字符]…\n${text.slice(text.length - tail)}`;
}

/**
 * 对超长单条消息做裁剪。最后一条用户消息也裁剪，但保留更大的预算；
 * 否则一个 2M 字符的附件会直接让上游返回 400/413。
 */
function clipOversizedMessages(messages: ChatMessage[]): { messages: ChatMessage[]; clipped: number } {
  let clipped = 0;
  const next = messages.map((message, index) => {
    const isLast = index === messages.length - 1;
    const limit = isLast ? MAX_LAST_MESSAGE_TOKENS : MAX_HISTORY_MESSAGE_TOKENS;
    if (estimateTokens(message.content) <= limit) return message;
    clipped += 1;
    return { ...message, content: clipText(message.content, limit) };
  });
  return { messages: next, clipped };
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

async function summarizeText(
  content: string,
  onUsage?: (usage: TokenUsage | null, keyId: number) => void,
): Promise<string> {
  const payload = {
    model: config.model,
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content },
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
    const text = message.content.replace(/\s+/g, " ").slice(0, 200);
    return `${label}：${text}${message.content.length > 200 ? "…" : ""}`;
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
    return await summarizeText(transcript(segment), onUsage);
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

function summaryKey(text: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: SUMMARY_CACHE_VERSION, kind: "merge", text }))
    .digest("hex");
}

/**
 * 摘要块总预算控制：把多段摘要按 token 重新分组、递归归并，
 * 直到摘要块本身不超过 SUMMARY_BUDGET_TOKENS。任何一步失败都退化为截断，
 * 不会让整个对话失败。
 */
async function fitSummaryBudget(
  summaries: string[],
  onUsage?: (usage: TokenUsage | null, keyId: number) => void,
): Promise<string> {
  const header =
    "以下内容是对更早对话的结构化压缩，按时间顺序排列。它只用于保持任务、事实和设定连续；" +
    "不要向用户提及“摘要”或“压缩”。";
  let parts = summaries.map((summary, index) => `【历史 ${index + 1}】\n${summary}`);
  let depth = 0;

  const render = () => `${header}\n\n${parts.join("\n\n")}`;

  while (estimateTokens(render()) > SUMMARY_BUDGET_TOKENS && depth < 3) {
    const groups: string[][] = [];
    let current: string[] = [];
    let tokens = 0;
    for (const part of parts) {
      const partTokens = estimateTokens(part) + 4;
      if (current.length > 0 && tokens + partTokens > SEGMENT_MAX_TOKENS) {
        groups.push(current);
        current = [];
        tokens = 0;
      }
      current.push(part);
      tokens += partTokens;
    }
    if (current.length > 0) groups.push(current);

    // 单组也超预算时，先截断再归纳，避免摘要请求本身超限。
    if (groups.length <= 1) {
      const clipped = clipText(parts.join("\n\n"), SEGMENT_MAX_TOKENS);
      const key = summaryKey(clipped);
      const hit = getContextSummary(key);
      if (hit) {
        parts = [hit];
      } else {
        const summary = await summarizeText(clipped, onUsage);
        putContextSummary(key, summary);
        parts = [summary];
      }
      depth += 1;
      continue;
    }

    parts = await Promise.all(
      groups.map(async (group) => {
        const text = group.join("\n\n");
        const key = summaryKey(text);
        const hit = getContextSummary(key);
        if (hit) return hit;
        try {
          const summary = await summarizeText(text, onUsage);
          putContextSummary(key, summary);
          return summary;
        } catch {
          return clipText(text, SEGMENT_MAX_TOKENS);
        }
      }),
    );
    depth += 1;
  }

  const block = render();
  if (estimateTokens(block) <= SUMMARY_BUDGET_TOKENS) return block;
  return `${header}\n\n${clipText(parts.join("\n\n"), SUMMARY_BUDGET_TOKENS)}`;
}

/**
 * 把过长的历史压成分段摘要，只保留最近一段原文。
 * 摘要按分段内容哈希缓存，追加新消息时旧分段不会重复计算。
 */
function leadingKey(segment: ChatMessage[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: SUMMARY_CACHE_VERSION, kind: "lead", segment }))
    .digest("hex");
}

/**
 * 把前 count 条消息压成一条 system 摘要，剩余消息保持原样。
 * 用于按条数触发的静默压缩，以及内容审核拒绝后的重试。
 */
export async function compactLeadingMessages(
  messages: ChatMessage[],
  count = LEAD_COMPACT_COUNT,
  onUsage?: (usage: TokenUsage | null, keyId: number) => void,
): Promise<LeadingCompaction> {
  const size = Math.min(Math.max(1, count), messages.length - 1);
  if (messages.length <= 2 || size <= 0) {
    return { messages, compacted: false, summaryTokens: 0 };
  }
  const head = messages.slice(0, size);
  const rest = messages.slice(size);
  const key = leadingKey(head);
  const cached = getContextSummary(key);
  let summary = cached;
  if (!summary) {
    summary = await summarizeSegmentSafe(head, onUsage);
    putContextSummary(key, summary);
  }
  const block = `【较早对话摘要】\n${summary}`;
  return {
    messages: [{ role: "system" as const, content: block }, ...rest],
    compacted: true,
    summaryTokens: estimateTokens(block),
  };
}

export async function compressContext(
  messages: ChatMessage[],
  options: { onUsage?: (usage: TokenUsage | null, keyId: number) => void } = {},
): Promise<CompressionOutcome> {
  const originalMessages = messages.length;
  const clipped = clipOversizedMessages(messages);
  let prepared = clipped.messages;
  let leadCompacted = false;
  let leadSummaryTokens = 0;
  if (prepared.length > LEAD_COMPACT_TRIGGER) {
    const compacted = await compactLeadingMessages(prepared, LEAD_COMPACT_COUNT, options.onUsage);
    prepared = compacted.messages;
    leadCompacted = compacted.compacted;
    leadSummaryTokens = compacted.summaryTokens;
    if (leadCompacted) {
      console.log(
        `[dream-server] context compacted by count: ${originalMessages} -> ${prepared.length} messages (${LEAD_COMPACT_COUNT} leading summarized)`,
      );
    }
  }
  // 裁剪后仍可能很短；只要发生过裁剪，就返回裁剪后的历史，避免原始超大消息再次发送。
  if (!needsCompression(prepared) && !leadCompacted) {
    return {
      messages: prepared,
      compressed: clipped.clipped > 0 || leadCompacted,
      segments: 0,
      cached: 0,
      originalMessages,
      estimatedTokens: estimateMessagesTokens(prepared),
      clippedMessages: clipped.clipped,
      summaryTokens: leadSummaryTokens,
    };
  }

  const enforceTokenLimit = (items: ChatMessage[]): ChatMessage[] => {
    if (estimateMessagesTokens(items) <= CONTEXT_TOKEN_LIMIT || items.length <= 2) return items;
    const kept = [...items];
    while (kept.length > 2 && estimateMessagesTokens(kept) > CONTEXT_TOKEN_LIMIT) {
      kept.splice(1, 1);
    }
    return kept;
  };

  // 从尾部保留最近消息，直到达到 token/条数上限；至少保留最近 8 条。
  let cut = prepared.length;
  let recentTokens = 0;
  let recentCount = 0;
  while (cut > 0 && recentCount < KEEP_RECENT_MESSAGES) {
    const messageTokens = estimateTokens(prepared[cut - 1].content) + 4;
    if (recentCount >= 8 && recentTokens + messageTokens > KEEP_RECENT_TOKENS) break;
    recentTokens += messageTokens;
    recentCount += 1;
    cut -= 1;
  }

  const older = prepared.slice(0, cut);
  const recent = prepared.slice(cut);
  const segments = splitSegments(older);

  if (segments.length === 0) {
    return {
      messages: enforceTokenLimit(prepared),
      compressed: clipped.clipped > 0,
      segments: 0,
      cached: 0,
      originalMessages,
      estimatedTokens: estimateMessagesTokens(prepared),
      clippedMessages: clipped.clipped,
      summaryTokens: 0,
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

  const summaryBlock = await fitSummaryBudget(summaries, options.onUsage);
  const finalMessages = enforceTokenLimit([{ role: "system" as const, content: summaryBlock }, ...recent]);
  return {
    messages: finalMessages,
    compressed: true,
    segments: segments.length,
    cached,
    originalMessages,
    estimatedTokens: estimateMessagesTokens(finalMessages),
    clippedMessages: clipped.clipped,
    summaryTokens: leadSummaryTokens + estimateTokens(summaryBlock),
  };
}
