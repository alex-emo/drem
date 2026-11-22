import { PassThrough, Readable } from "node:stream";
import { once } from "node:events";
import unzipper from "unzipper";

/**
 * 大体积 DeepSeek 导出 ZIP 的流式导入：
 * HTTP 下载 -> 边下边解压 -> 逐会话归一化 -> NDJSON 返回给客户端。
 * 服务端不在内存里保存整个 ZIP，也不落盘。
 */

export const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;

export class ArchiveImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ArchiveStats {
  conversations: number;
  messages: number;
  skippedConversations: number;
  skippedMessages: number;
  attachments: number;
  bytes: number;
}

export interface ArchiveConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ArchiveMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  status: "done" | "error";
  error?: string;
  createdAt: number;
}

interface DsFragment {
  type: string;
  content?: unknown;
}

interface DsMessage {
  id: number;
  parent_id: number | null;
  role: "USER" | "ASSISTANT";
  status: string;
  inserted_at: string;
  fragments: DsFragment[];
}

interface DsSession {
  id: string;
  title: string | null;
  current_message_id: number;
  inserted_at: string;
  updated_at: string;
  messages: DsMessage[];
}

const SUPPORTED_VERSION = 3;

export function validateArchiveUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ArchiveImportError("链接格式不正确。");
  }
  if (url.protocol !== "https:") throw new ArchiveImportError("只支持 https 链接。");
  if (!/(^|\.)myhuaweicloud\.com$/i.test(url.hostname)) {
    throw new ArchiveImportError("暂只支持华为云 OBS（myhuaweicloud.com）的 DeepSeek 导出链接。");
  }
  return url;
}

function timeOf(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentBranch(session: DsSession): DsMessage[] {
  const byId = new Map(session.messages.map((message) => [message.id, message]));
  let current = byId.get(session.current_message_id);
  if (!current) current = [...session.messages].sort((a, b) => a.id - b.id).at(-1);
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
    if (fragment.type === "RESPONSE" || fragment.type === "TEMPLATE_RESPONSE") content.push(fragment.content);
    else if (fragment.type === "THINK") reasoning.push(fragment.content);
  }
  return { content: content.join(""), reasoning: reasoning.join("\n\n").trim() };
}

function makeTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 24 ? `${clean.slice(0, 24)}…` : clean;
}

function convertSession(session: DsSession, now: number): {
  conversation: ArchiveConversation;
  messages: ArchiveMessage[];
  skippedMessages: number;
  attachments: number;
} {
  const conversationId = `ds-${session.id}`;
  const insertedAt = timeOf(session.inserted_at, now);
  const updatedAt = Math.max(timeOf(session.updated_at, insertedAt), insertedAt);
  const branch = currentBranch(session);
  const messages: ArchiveMessage[] = [];
  let skippedMessages = 0;
  let attachments = 0;
  let previousTime = insertedAt;

  for (const message of branch) {
    attachments += message.fragments.filter((fragment) => fragment.type === "FILE").length;
    const createdAt = Math.max(timeOf(message.inserted_at, previousTime), previousTime);
    previousTime = createdAt;

    if (message.role === "USER") {
      const content = userText(message);
      if (!content) {
        skippedMessages += 1;
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
      continue;
    }

    const { content, reasoning } = assistantParts(message);
    if (!content && !reasoning) {
      skippedMessages += 1;
      continue;
    }
    const failed = ["FAILED", "TIMEOUT", "CONTEXT_LENGTH_EXCEEDED"].includes(message.status);
    messages.push({
      id: `ds-${session.id}-${message.id}`,
      conversationId,
      role: "assistant",
      content,
      ...(reasoning ? { reasoning } : {}),
      status: failed ? "error" : "done",
      ...(failed ? { error: "这条回复在 DeepSeek 客户端中生成失败或超长中断。" } : {}),
      createdAt,
    });
  }

  const firstUser = messages.find((message) => message.role === "user")?.content ?? "";
  return {
    conversation: {
      id: conversationId,
      title: (session.title ?? "").trim() || makeTitle(firstUser) || "未命名对话",
      createdAt: insertedAt,
      updatedAt,
    },
    messages,
    skippedMessages,
    attachments,
  };
}

export interface ArchiveImportOptions {
  url: string;
  skipIds: Set<string>;
  write: (payload: unknown) => Promise<void>;
}

export async function streamArchiveImport({ url, skipIds, write }: ArchiveImportOptions): Promise<ArchiveStats> {
  const target = validateArchiveUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  const stats: ArchiveStats = {
    conversations: 0,
    messages: 0,
    skippedConversations: 0,
    skippedMessages: 0,
    attachments: 0,
    bytes: 0,
  };

  try {
    const response = await fetch(target, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new ArchiveImportError(`下载导出文件失败：HTTP ${response.status}`, 502);
    if (!response.url.startsWith("https://")) throw new ArchiveImportError("下载重定向到了非 https 地址。", 502);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_ARCHIVE_BYTES) {
      throw new ArchiveImportError("导出文件超过 300MB 上限。", 413);
    }
    if (!response.body) throw new ArchiveImportError("导出文件下载失败。", 502);

    const zip = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(
      unzipper.Parse({ forceStream: true }),
    );
    let manifestChecked = false;

    for await (const entry of zip as unknown as AsyncIterable<unzipper.Entry>) {
      if (entry.type !== "File") {
        entry.autodrain();
        continue;
      }
      const path = entry.path;
      if (path === "manifest.json") {
        const manifest = JSON.parse((await entry.buffer()).toString("utf8")) as { export_format_version?: number };
        if (manifest.export_format_version !== SUPPORTED_VERSION) {
          throw new ArchiveImportError(`暂不支持导出格式版本 ${manifest.export_format_version ?? "未知"}。`);
        }
        manifestChecked = true;
        continue;
      }
      if (path === "chat_session_index.json" || path === "user.json") {
        entry.autodrain();
        continue;
      }
      if (!path.startsWith("chat_sessions/") || !path.endsWith(".json")) {
        entry.autodrain();
        continue;
      }
      const sessionId = path.slice("chat_sessions/".length, -".json".length);
      if (skipIds.has(`ds-${sessionId}`)) {
        entry.autodrain();
        stats.skippedConversations += 1;
        continue;
      }
      let session: DsSession;
      try {
        session = JSON.parse((await entry.buffer()).toString("utf8")) as DsSession;
      } catch {
        entry.autodrain();
        stats.skippedConversations += 1;
        await write({ type: "warning", message: `跳过损坏的会话 ${sessionId}` });
        continue;
      }
      if (!manifestChecked) throw new ArchiveImportError("导出文件缺少 manifest.json，可能不完整。");
      const converted = convertSession(session, Date.now());
      if (converted.messages.length === 0) {
        stats.skippedConversations += 1;
        continue;
      }
      stats.conversations += 1;
      stats.messages += converted.messages.length;
      stats.skippedMessages += converted.skippedMessages;
      stats.attachments += converted.attachments;
      await write({ type: "conversation", conversation: converted.conversation });
      for (let index = 0; index < converted.messages.length; index += 200) {
        await write({ type: "messages", messages: converted.messages.slice(index, index + 200) });
      }
    }
    if (!manifestChecked) throw new ArchiveImportError("导出文件缺少 manifest.json，可能不完整。");
    return stats;
  } finally {
    clearTimeout(timer);
  }
}

export function archiveStream(): { pass: PassThrough; write: (payload: unknown) => Promise<void> } {
  const pass = new PassThrough();
  const write = async (payload: unknown) => {
    const line = `${JSON.stringify(payload)}\n`;
    if (!pass.write(line)) await once(pass, "drain");
  };
  return { pass, write };
}
