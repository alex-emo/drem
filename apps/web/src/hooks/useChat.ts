import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatApiError, streamChat, warmContext } from "../lib/api";
import {
  buildVersions,
  getVisibleMessages,
  normalizeMessages,
  selectVersion,
} from "../lib/branches";
import {
  deleteConversationData,
  getMessages,
  importConversationData,
  listConversations,
  putConversation,
  putMessage,
  putMessages,
} from "../lib/db";
import type { ImportedArchive } from "../lib/importArchive";
import { buildShareImport } from "../lib/shareImport";
import type { Conversation, FileAttachment, Message, SearchSource } from "../lib/types";
import { makeTitle, newId } from "../lib/utils";

export interface ImportOutcome {
  added: number;
  skipped: number;
  messages: number;
  skippedMessages: number;
  attachments: number;
}

export type ChatController = ReturnType<typeof useChat>;

const WARM_MESSAGE_THRESHOLD = 300;
const WARM_CHAR_THRESHOLD = 600_000;

/** 导入后静默预热长对话的分段摘要，不阻塞导入结果。 */
function warmLongConversations(conversations: Conversation[], messages: Message[]): void {
  for (const conversation of conversations) {
    const list = messages
      .filter((message) => message.conversationId === conversation.id && message.content)
      .map((message) => ({ role: message.role, content: message.content }));
    const chars = list.reduce((total, message) => total + message.content.length, 0);
    if (list.length > WARM_MESSAGE_THRESHOLD || chars > WARM_CHAR_THRESHOLD) {
      void warmContext(list).catch(() => undefined);
    }
  }
}

function historyFor(messages: Message[]) {
  return messages
    .filter(
      (message) =>
        message.role === "user" ||
        (message.role === "assistant" &&
          (message.status === "done" || message.status === "refused") &&
          message.content.trim().length > 0),
    )
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
}

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** 当前分支上可见的消息。 */
  const [messages, setMessages] = useState<Message[]>([]);
  /** 全部版本的消息树。 */
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const allMessagesRef = useRef<Message[]>([]);
  const rootRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const versions = useMemo(() => buildVersions(allMessages), [allMessages]);

  const remember = (id: string | null) => {
    try {
      if (id) localStorage.setItem("dream-active-id", id);
      else localStorage.removeItem("dream-active-id");
    } catch {
      // 忽略隐私模式下的存储错误
    }
  };

  const showVisible = useCallback((all: Message[], rootId: string | null) => {
    const visible = getVisibleMessages(all, rootId);
    messagesRef.current = visible;
    setMessages(visible);
    return visible;
  }, []);

  const updateConversation = useCallback(async (updated: Conversation) => {
    conversationsRef.current = conversationsRef.current.map((item) =>
      item.id === updated.id ? updated : item,
    );
    setConversations((prev) => {
      const list = prev.map((item) => (item.id === updated.id ? updated : item));
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    });
    await putConversation(updated);
  }, []);

  const loadConversation = useCallback(
    async (id: string) => {
      const raw = await getMessages(id);
      const normalized = normalizeMessages(raw);
      const conversation = conversationsRef.current.find((item) => item.id === id);
      const preferred =
        conversation?.rootMessageId &&
        normalized.messages.some((message) => message.id === conversation.rootMessageId)
          ? conversation.rootMessageId
          : normalized.rootId;

      allMessagesRef.current = normalized.messages;
      setAllMessages(normalized.messages);
      rootRef.current = preferred;
      activeRef.current = id;
      setActiveId(id);
      showVisible(normalized.messages, preferred);

      if (normalized.changed) await putMessages(normalized.messages);
      if (conversation && conversation.rootMessageId !== preferred) {
        await updateConversation({ ...conversation, rootMessageId: preferred });
      }
      if (conversation) warmLongConversations([conversation], getVisibleMessages(normalized.messages, preferred));
    },
    [showVisible, updateConversation],
  );

  useEffect(() => {
    let alive = true;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("dream-active-id");
    } catch {
      saved = null;
    }
    (async () => {
      const items = await listConversations();
      if (!alive) return;
      conversationsRef.current = items;
      setConversations(items);
      if (saved && items.some((item) => item.id === saved)) {
        await loadConversation(saved);
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [loadConversation]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    activeRef.current = null;
    setMessages([]);
    messagesRef.current = [];
    setAllMessages([]);
    allMessagesRef.current = [];
    rootRef.current = null;
    remember(null);
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      await loadConversation(id);
      remember(id);
    },
    [loadConversation],
  );

  const removeConversation = useCallback(async (id: string) => {
    await deleteConversationData(id);
    setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
    if (activeRef.current === id) {
      abortRef.current?.abort();
      setActiveId(null);
      activeRef.current = null;
      setMessages([]);
      messagesRef.current = [];
      setAllMessages([]);
      allMessagesRef.current = [];
      rootRef.current = null;
      remember(null);
    }
  }, []);

  const importHistory = useCallback(
    async (archive: ImportedArchive): Promise<ImportOutcome> => {
      const existing = new Set(conversationsRef.current.map((conversation) => conversation.id));
      const fresh = archive.conversations.filter((conversation) => !existing.has(conversation.id));
      const freshIds = new Set(fresh.map((conversation) => conversation.id));
      const freshMessages = archive.messages.filter((message) =>
        freshIds.has(message.conversationId),
      );

      if (fresh.length > 0) {
        await importConversationData(fresh, freshMessages);
        const items = await listConversations();
        conversationsRef.current = items;
        setConversations(items);
        const newest = fresh.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
        await openConversation(newest.id);
      }

      return {
        added: fresh.length,
        skipped: archive.conversations.length - fresh.length,
        messages: freshMessages.length,
        skippedMessages: archive.stats.skippedMessages,
        attachments: archive.stats.attachments,
      };
    },
    [openConversation],
  );

  const importShare = useCallback(
    async (url: string): Promise<ImportOutcome> => {
      const archive = await buildShareImport(url);
      if (conversationsRef.current.some((item) => item.id === archive.conversation.id)) {
        return {
          added: 0,
          skipped: 1,
          messages: 0,
          skippedMessages: archive.messages.length,
          attachments: archive.attachments,
        };
      }

      await importConversationData([archive.conversation], archive.messages);
      const items = await listConversations();
      conversationsRef.current = items;
      setConversations(items);
      await openConversation(archive.conversation.id);

      return {
        added: 1,
        skipped: 0,
        messages: archive.messages.length,
        skippedMessages: 0,
        attachments: archive.attachments,
      };
    },
    [openConversation],
  );

  const runReply = useCallback(
    async (
      conversation: Conversation,
      assistantMessage: Message,
      history: { role: "user" | "assistant"; content: string }[],
      options: { files?: FileAttachment[]; webSearch?: boolean } = {},
    ) => {
      setStreaming(true);
      streamingRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      const acc = { content: "", reasoning: "", sources: [] as SearchSource[] };
      let settled = false;
      let refused = false;

      // 隧道/代理常把 SSE 攒成一批送达；这里按时间把文本摊开显示。
      let pending = "";
      let timer: number | null = null;
      let streamEnded = false;
      let drainResolve: (() => void) | null = null;
      const drainPromise = new Promise<void>((resolve) => {
        drainResolve = resolve;
      });
      const tick = () => {
        if (pending) {
          const take = pending.length > 160 ? 8 : pending.length > 60 ? 6 : 4;
          acc.content += pending.slice(0, take);
          pending = pending.slice(take);
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMessage.id ? { ...message, content: acc.content } : message,
            ),
          );
        }
        if (!pending && streamEnded) {
          if (timer !== null) window.clearInterval(timer);
          timer = null;
          drainResolve?.();
          drainResolve = null;
        }
      };
      const ensureTimer = () => {
        if (timer === null) timer = window.setInterval(tick, 30);
      };

      const finish = async (
        status: "done" | "refused" | "error",
        error?: string,
        meta?: { code?: string; requestId?: string },
      ) => {
        if (settled) return;
        settled = true;
        abortRef.current = null;

        const final: Message = {
          ...assistantMessage,
          content: acc.content,
          reasoning: acc.reasoning || undefined,
          files: options.files,
          sources: acc.sources.length > 0 ? acc.sources : undefined,
          status,
          error,
          errorCode: meta?.code,
          errorRequestId: meta?.requestId,
        };
        allMessagesRef.current = allMessagesRef.current.map((message) =>
          message.id === assistantMessage.id ? final : message,
        );
        setAllMessages(allMessagesRef.current);
        messagesRef.current = messagesRef.current.map((message) =>
          message.id === assistantMessage.id ? final : message,
        );
        setMessages(messagesRef.current);
        setStreaming(false);
        streamingRef.current = false;

        try {
          await putMessage(final);
          const base = conversationsRef.current.find((item) => item.id === conversation.id) ?? conversation;
          await updateConversation({
            ...base,
            rootMessageId: rootRef.current,
            updatedAt: Date.now(),
          });
        } catch {
          // 本地存储失败不影响界面展示
        }
      };

      try {
        await streamChat({
          messages: history,
          thinking,
          files: options.files?.map((file) => file.id),
          webSearch: options.webSearch,
          signal: controller.signal,
          onSources: (sources) => {
            acc.sources = sources;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessage.id ? { ...message, sources } : message,
              ),
            );
          },
          onDelta: (chunk) => {
            pending += chunk;
            ensureTimer();
          },
          onReasoning: (chunk) => {
            acc.reasoning += chunk;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessage.id ? { ...message, reasoning: acc.reasoning } : message,
              ),
            );
          },
          onRefusal: (text) => {
            refused = true;
            acc.content = text;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessage.id ? { ...message, content: text } : message,
              ),
            );
          },
        });
        streamEnded = true;
        ensureTimer();
        if (pending) await drainPromise;
        if (timer !== null) window.clearInterval(timer);
        await finish(refused ? "refused" : "done");
      } catch (error) {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        pending = "";
        if (error instanceof Error && error.name === "AbortError") {
          await finish("done");
        } else {
          if (error instanceof ChatApiError && error.status === 401) {
            window.dispatchEvent(new CustomEvent("dream:unauthorized"));
          }
          const failure =
            error instanceof ChatApiError && error.code === "CONTENT_FILTERED"
              ? "这段对话触发了模型的内容安全策略，暂时无法继续。请修改最近几条消息，或新建一个会话再试。"
              : (error as Error).message || "生成失败，请稍后重试";
          const meta =
            error instanceof ChatApiError
              ? { code: error.code, requestId: error.requestId }
              : undefined;
          await finish("error", failure, meta);
        }
      }
    },
    [thinking, updateConversation],
  );

  const sendMessage = useCallback(
    async (raw: string, options: { files?: FileAttachment[]; webSearch?: boolean } = {}) => {
      const text = raw.trim();
      if (!text || streamingRef.current) return;

      const now = Date.now();
      let conversationId = activeRef.current;
      let conversation = conversationId
        ? (conversationsRef.current.find((item) => item.id === conversationId) ?? null)
        : null;
      const visible = messagesRef.current;
      const parentId = visible.at(-1)?.id ?? null;

      if (!conversationId) {
        conversationId = newId();
        conversation = {
          id: conversationId,
          title: makeTitle(text),
          createdAt: now,
          updatedAt: now,
          rootMessageId: null,
        };
        await putConversation(conversation);
        conversationsRef.current = [conversation, ...conversationsRef.current];
        setConversations((prev) => [conversation as Conversation, ...prev]);
        setActiveId(conversationId);
        activeRef.current = conversationId;
        remember(conversationId);
        rootRef.current = null;
      }

      const userMessage: Message = {
        id: newId(),
        conversationId,
        role: "user",
        content: text,
        files: options.files,
        status: "done",
        createdAt: now,
        parentId,
        selectedChildId: null,
      };

      const assistantMessage: Message = {
        id: newId(),
        conversationId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: now + 1,
        parentId: userMessage.id,
        selectedChildId: null,
      };
      userMessage.selectedChildId = assistantMessage.id;

      const rootId = rootRef.current ?? userMessage.id;
      rootRef.current = rootId;

      const all = [
        ...allMessagesRef.current.map((message) =>
          message.id === parentId ? { ...message, selectedChildId: userMessage.id } : message,
        ),
        userMessage,
        assistantMessage,
      ];
      allMessagesRef.current = all;
      setAllMessages(all);
      const nextVisible = [...visible, userMessage, assistantMessage];
      messagesRef.current = nextVisible;
      setMessages(nextVisible);
      await putMessage(userMessage);
      await putMessage(assistantMessage);
      if (conversation && conversation.rootMessageId !== rootId) {
        await putConversation({ ...conversation, rootMessageId: rootId });
      }

      const history = [...historyFor(visible), { role: "user" as const, content: text }];
      await runReply(conversation as Conversation, assistantMessage, history, options);
    },
    [runReply],
  );

  /** 编辑用户消息：在同一个父节点下新增版本并重新生成，旧分支仍可切回。 */
  const editMessage = useCallback(
    async (messageId: string, raw: string): Promise<boolean> => {
      const text = raw.trim();
      if (!text || streamingRef.current) return false;
      const conversationId = activeRef.current;
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversationId || !conversation) return false;

      const visible = messagesRef.current;
      const index = visible.findIndex((message) => message.id === messageId);
      const previous = visible[index];
      if (index < 0 || !previous || previous.role !== "user") return false;

      const now = Date.now();
      const parentId = previous.parentId ?? null;
      const userMessage: Message = {
        id: newId(),
        conversationId,
        role: "user",
        content: text,
        status: "done",
        createdAt: now,
        parentId,
        selectedChildId: null,
      };
      const assistantMessage: Message = {
        id: newId(),
        conversationId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: now + 1,
        parentId: userMessage.id,
        selectedChildId: null,
      };
      userMessage.selectedChildId = assistantMessage.id;

      const rootId = parentId === null ? userMessage.id : (rootRef.current ?? userMessage.id);
      rootRef.current = rootId;

      const before = visible.slice(0, index);
      const all = [
        ...allMessagesRef.current.map((message) =>
          parentId !== null && message.id === parentId
            ? { ...message, selectedChildId: userMessage.id }
            : message,
        ),
        userMessage,
        assistantMessage,
      ];
      allMessagesRef.current = all;
      setAllMessages(all);
      const nextVisible = [...before, userMessage, assistantMessage];
      messagesRef.current = nextVisible;
      setMessages(nextVisible);

      await putMessage(userMessage);
      await putMessage(assistantMessage);
      await putConversation({ ...conversation, rootMessageId: rootId, updatedAt: now });

      const history = [...historyFor(before), { role: "user" as const, content: text }];
      await runReply(conversation, assistantMessage, history, { files: previous.files });
      return true;
    },
    [runReply],
  );

  const selectMessageVersion = useCallback(
    async (messageId: string) => {
      if (streamingRef.current) return;
      const target = allMessagesRef.current.find((message) => message.id === messageId);
      if (!target) return;
      const result = selectVersion(allMessagesRef.current, messageId, rootRef.current);
      allMessagesRef.current = result.messages;
      setAllMessages(result.messages);
      if (result.rootId !== rootRef.current) {
        rootRef.current = result.rootId;
        const conversationId = activeRef.current;
        const conversation = conversationsRef.current.find((item) => item.id === conversationId);
        if (conversation) await updateConversation({ ...conversation, rootMessageId: result.rootId });
      } else if (target.parentId) {
        const parent = result.messages.find((message) => message.id === target.parentId);
        if (parent) await putMessage(parent);
      }
      showVisible(result.messages, result.rootId);
    },
    [showVisible, updateConversation],
  );

  return {
    conversations,
    activeId,
    messages,
    versions,
    streaming,
    thinking,
    setThinking,
    sendMessage,
    editMessage,
    selectMessageVersion,
    stop,
    newChat,
    openConversation,
    removeConversation,
    importHistory,
    importShare,
  };
}
