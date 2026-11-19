import type { Message } from "./types";

export interface VersionInfo {
  ids: string[];
  index: number;
}

function chronological(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * DeepSeek 编辑提问会在同一父节点下新增一个用户消息版本，旧回答与后续对话
 * 都保留在消息树里。早期会话与导入会话是线性的，首次加载时补成单分支树。
 */
export function normalizeMessages(messages: Message[]): {
  messages: Message[];
  rootId: string | null;
  changed: boolean;
} {
  if (messages.length === 0) {
    return { messages, rootId: null, changed: false };
  }
  const sorted = chronological(messages);
  const hasTree = sorted.some((message) => typeof message.parentId !== "undefined");
  if (hasTree) {
    const roots = sorted.filter((message) => !message.parentId);
    return { messages: sorted, rootId: roots[0]?.id ?? sorted[0].id, changed: false };
  }
  const normalized = sorted.map((message, index) => ({
    ...message,
    parentId: index === 0 ? null : sorted[index - 1].id,
    selectedChildId: sorted[index + 1]?.id ?? null,
  }));
  return { messages: normalized, rootId: normalized[0].id, changed: true };
}

function childrenOf(messages: Message[], parentId: string | null): Message[] {
  return chronological(messages.filter((message) => (message.parentId ?? null) === parentId));
}

/** 沿 selectedChildId 还原当前选中的分支；子节点丢失时回退到最早的兄弟。 */
export function getVisibleMessages(messages: Message[], rootId: string | null): Message[] {
  if (messages.length === 0) return [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  let cursor = rootId && byId.has(rootId) ? rootId : messages.find((message) => !message.parentId)?.id;
  const seen = new Set<string>();
  const path: Message[] = [];
  while (cursor) {
    const message = byId.get(cursor);
    if (!message || seen.has(message.id)) break;
    seen.add(message.id);
    path.push(message);
    let next = message.selectedChildId ?? null;
    if (!next || !byId.has(next)) {
      next = childrenOf(messages, message.id)[0]?.id ?? null;
    }
    cursor = next;
  }
  return path;
}

/** 全部消息按父节点分组，用于「1 / 2」版本切换器。 */
export function buildVersions(messages: Message[]): Map<string, VersionInfo> {
  const groups = new Map<string | null, Message[]>();
  for (const message of messages) {
    const parentId = message.parentId ?? null;
    const group = groups.get(parentId);
    if (group) group.push(message);
    else groups.set(parentId, [message]);
  }
  const versions = new Map<string, VersionInfo>();
  for (const group of groups.values()) {
    const ids = chronological(group).map((message) => message.id);
    ids.forEach((id, index) => versions.set(id, { ids, index }));
  }
  return versions;
}

export function siblingsOf(messages: Message[], message: Message): Message[] {
  return chronological(messages.filter((item) => (item.parentId ?? null) === (message.parentId ?? null)));
}

/** 选中某个版本，恢复该版本自己的后续分支。 */
export function selectVersion(
  messages: Message[],
  messageId: string,
  rootId: string | null,
): { messages: Message[]; rootId: string | null } {
  const target = messages.find((message) => message.id === messageId);
  if (!target) return { messages, rootId };
  const parentId = target.parentId ?? null;
  if (parentId === null) {
    return { messages, rootId: target.id };
  }
  return {
    messages: messages.map((message) =>
      message.id === parentId ? { ...message, selectedChildId: target.id } : message,
    ),
    rootId,
  };
}
