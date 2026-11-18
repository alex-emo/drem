import { unzip } from "fflate";
import type { Conversation, Message } from "./types";
import { makeTitle } from "./utils";

/**
 * 解析 DeepSeek 客户端导出的 deepseek_data-*.zip。
 *
 * 只导入纯文本对话（提问 / 回答 / 深度思考），图片与文件附件暂不支持。
 * 导出格式参考官方 chat-demo：manifest.json + chat_sessions/*.json +
 * chat_session_index.json，版本 3。
 */

export class ImportError extends Error {}

export interface ImportStats {
  conversations: number;
  messages: number;
  skippedConversations: number;
  skippedMessages: number;
  attachments: number;
}

export interface ImportedArchive {
  conversations: Conversation[];
  messages: Message[];
  stats: ImportStats;
}

const SUPPORTED_VERSION = 3;

type Json = Record<string, unknown>;

interface DsFragment extends Json {
  type: string;
  content?: unknown;
}

interface DsMessage extends Json {
  id: number;
  parent_id: number | null;
  role: "USER" | "ASSISTANT";
  status: string;
  inserted_at: string;
  fragments: DsFragment[];
}

interface DsSession extends Json {
  id: string;
  title: string | null;
  current_message_id: number;
  inserted_at: string;
  updated_at: string;
  messages: DsMessage[];
}

function fail(message: string): never {
  throw new ImportError(message);
}

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, files) => {
      if (error) reject(new ImportError("无法解压这个 ZIP 文件，请确认它是 DeepSeek 导出的聊天记录。"));
      else resolve(files);
    });
  });
}

function decodeJson<T = unknown>(bytes: Uint8Array | undefined, label: string): T {
  if (!bytes) fail(`导出文件缺少 ${label}，可能不完整。`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    fail(`${label} 不是合法的 JSON，导出文件可能已损坏。`);
  }
}

function asObject(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} 格式不正确。`);
  return value as Json;
}

function timeOf(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 沿 current_message_id 的父链取当前分支；异常时退回 id 最大的消息。 */
function currentBranch(session: DsSession): DsMessage[] {
  const byId = new Map(session.messages.map((message) => [message.id, message]));
  let current = byId.get(session.current_message_id);
  if (!current) {
    current = [...session.messages].sort((a, b) => a.id - b.id).at(-1);
  }
  const path: DsMessage[] = [];
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    if (current.parent_id === null) break;
    current = byId.get(current.parent_id);
  }
  return path.reverse();
}

function userText(message: DsMessage): string {
  return message.fragments
    .filter((fragment) => fragment.type === "REQUEST" && typeof fragment.content === "string")
    .map((fragment) => fragment.content as string)
    .join("")
    .trim();
}

function assistantParts(message: DsMessage): { content: string; reasoning: string } {
  const content: string[] = [];
  const reasoning: string[] = [];
  for (const fragment of message.fragments) {
    if (typeof fragment.content !== "string") continue;
    if (fragment.type === "RESPONSE" || fragment.type === "TEMPLATE_RESPONSE") {
      content.push(fragment.content);
    } else if (fragment.type === "THINK") {
      reasoning.push(fragment.content);
    }
  }
  return { content: content.join(""), reasoning: reasoning.join("\n\n").trim() };
}

function assistantStatus(status: string): { status: Message["status"]; error?: string } {
  switch (status) {
    case "FAILED":
    case "TIMEOUT":
    case "CONTEXT_LENGTH_EXCEEDED":
      return { status: "error", error: "这条回复在 DeepSeek 客户端中生成失败或超长中断。" };
    default:
      // WIP / INCOMPLETE 视为用户主动停止，已生成的部分保留
      return { status: "done" };
  }
}

function convertSession(session: DsSession, now: number): {
  conversation: Conversation;
  messages: Message[];
  stats: ImportStats;
} {
  const conversationId = `ds-${session.id}`;
  const insertedAt = timeOf(session.inserted_at, now);
  const updatedAt = Math.max(timeOf(session.updated_at, insertedAt), insertedAt);
  const branch = currentBranch(session);
  const messages: Message[] = [];
  const stats: ImportStats = {
    conversations: 0,
    messages: 0,
    skippedConversations: 0,
    skippedMessages: 0,
    attachments: 0,
  };

  let previousTime = insertedAt;
  for (const message of branch) {
    stats.attachments += message.fragments.filter((fragment) => fragment.type === "FILE").length;

    const createdAt = Math.max(timeOf(message.inserted_at, previousTime), previousTime);
    previousTime = createdAt;

    if (message.role === "USER") {
      const content = userText(message);
      if (!content) {
        stats.skippedMessages += 1;
        continue;
      }
      messages.push({
        id: `ds-${session.id}-${message.id}`,
        conversationId,
        role: "user",
        content,
        status: "done",
        createdAt,
      });
      stats.messages += 1;
      continue;
    }

    const { content, reasoning } = assistantParts(message);
    if (!content && !reasoning) {
      // 只有工具调用 / 附件、没有可见文字的消息暂不展示
      stats.skippedMessages += 1;
      continue;
    }

    const mapped = assistantStatus(message.status);
    messages.push({
      id: `ds-${session.id}-${message.id}`,
      conversationId,
      role: "assistant",
      content,
      ...(reasoning ? { reasoning } : {}),
      status: mapped.status,
      ...(mapped.error ? { error: mapped.error } : {}),
      createdAt,
    });
    stats.messages += 1;
  }

  const firstUser = messages.find((message) => message.role === "user")?.content ?? "";
  const conversation: Conversation = {
    id: conversationId,
    title: (session.title ?? "").trim() || makeTitle(firstUser) || "未命名对话",
    createdAt: insertedAt,
    updatedAt,
  };
  stats.conversations = messages.length > 0 ? 1 : 0;
  return { conversation, messages, stats };
}

export async function parseDeepSeekArchive(file: File): Promise<ImportedArchive> {
  if (file.size > 200 * 1024 * 1024) {
    fail("这个文件超过 200MB，暂不支持导入这么大的聊天记录。");
  }
  if (!/\.zip$/i.test(file.name)) {
    fail("请选择 DeepSeek 导出的 .zip 文件。");
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImportError) throw error;
    fail("读取 ZIP 失败，请确认文件没有损坏。");
  }

  if (!entries["manifest.json"]) {
    fail("这不是 DeepSeek 导出的聊天记录：缺少 manifest.json。");
  }
  const manifest = asObject(decodeJson(entries["manifest.json"], "manifest.json"), "manifest.json");
  if (manifest.export_format_version !== SUPPORTED_VERSION) {
    fail(
      `导出格式版本为 ${String(manifest.export_format_version)}，当前仅支持版本 ${SUPPORTED_VERSION}（DeepSeek 最新导出）。`,
    );
  }

  const index = decodeJson<unknown>(entries["chat_session_index.json"], "chat_session_index.json");
  if (!Array.isArray(index)) {
    fail("chat_session_index.json 格式不正确。");
  }
  const indexed = new Set(
    index.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const id = (item as Json).id;
      return typeof id === "string" ? [id] : [];
    }),
  );

  const sessionPaths = Object.keys(entries).filter((path) =>
    /^chat_sessions\/[^/]+\.json$/.test(path),
  );
  if (sessionPaths.length === 0) {
    fail("导出文件中没有找到任何会话。");
  }

  const now = Date.now();
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const stats: ImportStats = {
    conversations: 0,
    messages: 0,
    skippedConversations: 0,
    skippedMessages: 0,
    attachments: 0,
  };

  for (const path of sessionPaths) {
    const sessionId = /^chat_sessions\/([^/]+)\.json$/.exec(path)?.[1];
    if (!sessionId) continue;
    const raw = asObject(decodeJson(entries[path], path), path);
    if (typeof raw.id !== "string" || raw.id !== sessionId) {
      fail(`会话文件 ${path} 的 id 不匹配，导出文件可能已损坏。`);
    }
    if (!Array.isArray(raw.messages)) {
      fail(`会话 ${sessionId} 缺少消息列表。`);
    }
    const session = raw as unknown as DsSession;
    if (!indexed.has(sessionId)) {
      // index 只列出成功导出的会话；不在索引里的直接跳过，避免导入残缺数据
      stats.skippedConversations += 1;
      continue;
    }

    const converted = convertSession(session, now);
    if (converted.messages.length === 0) {
      stats.skippedConversations += 1;
      stats.skippedMessages += converted.stats.skippedMessages;
      stats.attachments += converted.stats.attachments;
      continue;
    }
    conversations.push(converted.conversation);
    messages.push(...converted.messages);
    stats.conversations += 1;
    stats.messages += converted.stats.messages;
    stats.skippedMessages += converted.stats.skippedMessages;
    stats.attachments += converted.stats.attachments;
  }

  if (conversations.length === 0) {
    fail("没有可导入的对话内容（可能只包含附件或工具调用）。");
  }

  conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  return { conversations, messages, stats };
}
