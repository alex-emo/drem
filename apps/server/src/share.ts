import { ApiError } from "./protocol.js";

export interface SharedMessage {
  role: "user" | "assistant";
  content: string;
  reasoning: string;
  status: "done" | "error";
  createdAt: number;
}

export interface SharedChat {
  shareId: string;
  title: string;
  attachments: number;
  messages: SharedMessage[];
}

interface RawFragment {
  type?: string;
  content?: string;
  files?: unknown[];
}

interface RawMessage {
  message_id?: number;
  parent_id?: number | null;
  role?: string;
  status?: string;
  inserted_at?: number;
  fragments?: RawFragment[];
}

const SHARE_URL_RE = /^https?:\/\/chat\.deepseek\.com\/share\/([A-Za-z0-9_-]+)\/?$/;
const SHARE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function parseShareId(input: string): string | null {
  const value = input.trim();
  if (SHARE_ID_RE.test(value)) return value;
  const match = SHARE_URL_RE.exec(value);
  return match ? match[1] : null;
}

const ERROR_STATUSES = new Set(["FAILED", "TIMEOUT", "CONTEXT_LENGTH_EXCEEDED"]);

function joinFragments(fragments: RawFragment[], types: string[]): string {
  return fragments
    .filter((fragment) => typeof fragment.type === "string" && types.includes(fragment.type))
    .map((fragment) => (typeof fragment.content === "string" ? fragment.content : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function currentBranch(messages: RawMessage[]): RawMessage[] {
  if (messages.length === 0) return [];
  const byId = new Map<number, RawMessage>();
  for (const message of messages) {
    if (typeof message.message_id === "number") byId.set(message.message_id, message);
  }

  let cursor: RawMessage | undefined =
    [...messages].reverse().find((message) => typeof message.message_id === "number") ??
    messages[messages.length - 1];
  const chain: RawMessage[] = [];
  const seen = new Set<number>();

  while (cursor) {
    const id = cursor.message_id;
    if (typeof id === "number") {
      if (seen.has(id)) break;
      seen.add(id);
    }
    chain.push(cursor);
    if (typeof cursor.parent_id === "number") {
      cursor = byId.get(cursor.parent_id);
    } else {
      cursor = undefined;
    }
  }

  return chain.reverse();
}

/**
 * 分享接口会省略已删除的消息：parent_id 指向不存在的消息时，子消息就是下一段的起点。
 * 这里按“缺失父节点即分段”的规则还原可见消息；每段内仍取最晚的一条分支。
 */
function segmentedBranch(messages: RawMessage[]): RawMessage[] {
  if (messages.length === 0) return [];
  const byId = new Map<number, RawMessage>();
  const children = new Map<number, RawMessage[]>();
  const roots: RawMessage[] = [];
  for (const message of messages) {
    if (typeof message.message_id !== "number") continue;
    byId.set(message.message_id, message);
    const parent = message.parent_id;
    if (typeof parent === "number" && byId.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(message);
      children.set(parent, list);
    }
  }
  for (const message of messages) {
    if (typeof message.message_id !== "number") continue;
    if (typeof message.parent_id !== "number" || !byId.has(message.parent_id)) {
      roots.push(message);
    }
  }
  if (roots.length === 0) return currentBranch(messages);

  const at = (message: RawMessage) => (typeof message.inserted_at === "number" ? message.inserted_at : 0);
  roots.sort((a, b) => at(a) - at(b));
  const seen = new Set<number>();
  const result: RawMessage[] = [];
  for (const root of roots) {
    let latest = root;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (at(current) >= at(latest)) latest = current;
      for (const child of children.get(current.message_id as number) ?? []) stack.push(child);
    }
    const path: RawMessage[] = [];
    let cursor: RawMessage | undefined = latest;
    while (cursor && typeof cursor.message_id === "number") {
      path.push(cursor);
      const parentId = cursor.parent_id;
      cursor = typeof parentId === "number" ? byId.get(parentId) : undefined;
    }
    for (const message of path.reverse()) {
      const id = message.message_id;
      if (typeof id !== "number" || seen.has(id)) continue;
      seen.add(id);
      result.push(message);
    }
  }
  return result;
}

export async function fetchSharedChat(input: string): Promise<SharedChat> {
  const shareId = parseShareId(input);
  if (!shareId) {
    throw new ApiError(400, "INVALID_ARGUMENT", "请粘贴 DeepSeek 分享链接（https://chat.deepseek.com/share/…）");
  }

  let response: Response;
  try {
    response = await fetch(`https://chat.deepseek.com/api/v0/share/content?share_id=${encodeURIComponent(shareId)}`, {
      headers: {
        accept: "application/json",
        referer: `https://chat.deepseek.com/share/${shareId}`,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, "UPSTREAM_ERROR", "无法连接 DeepSeek 分享服务，请稍后再试");
  }

  if (!response.ok) {
    throw new ApiError(502, "UPSTREAM_ERROR", `DeepSeek 分享接口返回 HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(502, "UPSTREAM_ERROR", "分享内容不是合法 JSON");
  }

  const root = payload as {
    data?: { biz_code?: number; biz_data?: { title?: string; messages?: RawMessage[] } };
  };
  const biz = root.data?.biz_data;
  if (root.data?.biz_code !== 0 || !biz || !Array.isArray(biz.messages)) {
    throw new ApiError(404, "NOT_FOUND", "分享不存在或已被删除");
  }

  const branch = segmentedBranch(biz.messages);
  const messages: SharedMessage[] = [];
  let attachments = 0;

  for (const raw of branch) {
    const role = raw.role === "ASSISTANT" ? "assistant" : raw.role === "USER" ? "user" : null;
    if (!role) continue;

    const fragments = Array.isArray(raw.fragments) ? raw.fragments : [];
    if (role === "user") {
      attachments += fragments
        .filter((fragment) => fragment.type === "FILE")
        .reduce((count, fragment) => count + (Array.isArray(fragment.files) ? fragment.files.length : 1), 0);
    }

    const content =
      role === "user"
        ? joinFragments(fragments, ["REQUEST", "TEMPLATE_RESPONSE"]) ||
          (fragments.some((fragment) => fragment.type === "FILE") ? "[图片]" : "")
        : joinFragments(fragments, ["RESPONSE", "TEMPLATE_RESPONSE"]);
    const reasoning = role === "assistant" ? joinFragments(fragments, ["THINK"]) : "";

    if (!content && !reasoning) continue;

    const status = ERROR_STATUSES.has(raw.status ?? "") ? "error" : "done";
    const createdAt =
      typeof raw.inserted_at === "number" && Number.isFinite(raw.inserted_at)
        ? raw.inserted_at * 1000
        : Date.now();

    messages.push({ role, content, reasoning, status, createdAt });
  }

  if (messages.length === 0) {
    throw new ApiError(422, "INVALID_ARGUMENT", "这个分享里没有可导入的文字内容");
  }

  return {
    shareId,
    title: typeof biz.title === "string" ? biz.title : "",
    attachments,
    messages,
  };
}
