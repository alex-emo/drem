import { createHash } from "node:crypto";
import { config } from "./config.js";
import { getContextSummary, putContextSummary } from "./db.js";
import type { ChatMessage } from "./deepseek.js";
import { ApiError } from "./protocol.js";
import { requestUpstreamJson } from "./deepseek.js";

/** 超过任一阈值就压缩历史：1000 条或 300 万字符。 */
export const COMPRESS_MESSAGE_THRESHOLD = 1000;
export const COMPRESS_CHAR_THRESHOLD = 3_000_000;

/** 每个摘要分段的最大体积与并发数（避免单次摘要超出上游上下文）。 */
const SEGMENT_MAX_CHARS = 300_000;
const SEGMENT_MAX_MESSAGES = 500;
const SUMMARY_CONCURRENCY = 3;

/** 压缩时保留的最近消息数量与字符上限。 */
const KEEP_RECENT_MESSAGES = 200;
const KEEP_RECENT_MAX_CHARS = 400_000;

const SUMMARY_PROMPT = `你是对话记录压缩器。请把下面这段对话压缩成不超过 1000 字的中文摘要。要求：
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
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function contentChars(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

export function needsCompression(messages: ChatMessage[]): boolean {
  return (
    messages.length > COMPRESS_MESSAGE_THRESHOLD ||
    contentChars(messages) > COMPRESS_CHAR_THRESHOLD
  );
}

function splitSegments(messages: ChatMessage[]): ChatMessage[][] {
  const segments: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let chars = 0;

  for (const message of messages) {
    if (
      current.length > 0 &&
      (chars + message.content.length > SEGMENT_MAX_CHARS ||
        current.length >= SEGMENT_MAX_MESSAGES)
    ) {
      segments.push(current);
      current = [];
      chars = 0;
    }
    current.push(message);
    chars += message.content.length;
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
  return createHash("sha256").update(JSON.stringify(segment)).digest("hex");
}

async function summarizeSegment(segment: ChatMessage[]): Promise<string> {
  const payload =
    config.provider === "qwen"
      ? {
          model: config.model,
          messages: [
            { role: "system", content: SUMMARY_PROMPT },
            { role: "user", content: transcript(segment) },
          ],
          stream: false,
          enable_thinking: false,
          temperature: 0.2,
          max_tokens: 1200,
        }
      : {
          model: config.model,
          messages: [
            { role: "system", content: SUMMARY_PROMPT },
            { role: "user", content: transcript(segment) },
          ],
          stream: false,
          temperature: 0.2,
          max_tokens: 1200,
        };

  let data: ChatCompletionResponse;
  try {
    data = (await requestUpstreamJson(payload, 120_000)) as ChatCompletionResponse;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "UPSTREAM_ERROR",
      `整理长对话上下文失败：${(error as Error).message}`,
    );
  }


  const summary = data.choices?.[0]?.message?.content?.trim();
  if (!summary) {
    throw new ApiError(502, "UPSTREAM_ERROR", "上游没有返回摘要");
  }
  return summary;
}

/**
 * 把过长的历史压成分段摘要，只保留最近一段原文。
 * 摘要按分段内容哈希缓存，追加新消息时旧分段不会重复计算。
 */
export async function compressContext(messages: ChatMessage[]): Promise<CompressionOutcome> {
  if (!needsCompression(messages)) {
    return { messages, compressed: false, segments: 0, cached: 0, originalMessages: messages.length };
  }

  // 从尾部保留最近 200 条 / 40 万字符以内的原文。
  let cut = messages.length;
  let recentChars = 0;
  while (cut > 0) {
    const kept = messages.length - cut;
    if (kept >= KEEP_RECENT_MESSAGES) break;
    const chars = messages[cut - 1].content.length;
    if (kept >= 40 && recentChars + chars > KEEP_RECENT_MAX_CHARS) break;
    recentChars += chars;
    cut -= 1;
  }

  const older = messages.slice(0, cut);
  const recent = messages.slice(cut);
  const segments = splitSegments(older);

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
      try {
        const summary = await summarizeSegment(segment);
        putContextSummary(key, summary);
        summaries[index] = summary;
      } catch (error) {
        // 摘要失败不能拖垮整轮对话：用占位说明替代这一段，原始消息仍保留在客户端。
        console.warn(
          `[dream-server] context summary failed (segment ${index + 1}/${segments.length}, ${segment.length} messages, ${contentChars(segment)} chars): ${(error as Error).message}`,
        );
        summaries[index] = `（此前 ${segment.length} 条对话因摘要服务暂时不可用而未纳入摘要；请忽略这一条占位说明。）`;
      }
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
  };
}
