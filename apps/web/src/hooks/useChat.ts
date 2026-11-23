import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatApiError, importArchiveFromUrl, streamChat, warmContext } from "../lib/api";
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

/** 把当前分支里出现过的附件合并给后续轮次，避免下一轮追问丢失文件上下文。 */
function inheritedFiles(messages: Message[]): FileAttachment[] {
  const seen = new Map<string, FileAttachment>();
  for (const message of messages) {
    for (const file of message.files ?? []) {
      seen.set(file.id, file);
    }
  }
  return Array.from(seen.values()).slice(-8);
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
  const [storageError, setStorageError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const settleRef = useRef<((reason: "stop" | "timeout") => void) | null>(null);
  const activeRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const allMessagesRef = useRef<Message[]>([]);
  const rootRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const deletedIdsRef = useRef<Set<string>>(new Set());

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
      // 上次刷新/断网时残留的 streaming 状态不能永久卡住 UI。
      const repaired = raw.map((message) =>
        message.status === "streaming"
          ? { ...message, status: "stopped" as const, content: message.content }
          : message,
      );
      const normalized = normalizeMessages(repaired);
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

      if (normalized.changed || repaired.some((message, index) => message !== raw[index])) {
        await putMessages(normalized.messages);
      }
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
    })().catch((error: unknown) => {
      if (!alive) return;
      console.error("读取本地聊天记录失败", error);
      setStorageError("无法读取本地聊天记录。请确认浏览器允许本站使用存储（非无痕模式），刷新后重试。");
    });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [loadConversation]);

  const stop = useCallback(() => {
    settleRef.current?.("stop");
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    settleRef.current = null;
    setStreaming(false);
    streamingRef.current = false;
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
      abortRef.current = null;
      settleRef.current = null;
      setStreaming(false);
      streamingRef.current = false;
      await loadConversation(id);
      remember(id);
    },
    [loadConversation],
  );

  const removeConversation = useCallback(async (id: string) => {
    deletedIdsRef.current.add(id);
    if (activeRef.current === id) {
      settleRef.current?.("stop");
      abortRef.current?.abort();
      abortRef.current = null;
      settleRef.current = null;
      setStreaming(false);
      streamingRef.current = false;
    }
    await deleteConversationData(id);
    setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
    if (activeRef.current === id) {
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
      // 分享内容可能因 DeepSeek 删改历史而变长；重复导入时用最新快照替换旧版本。
      if (conversationsRef.current.some((item) => item.id === archive.conversation.id)) {
        await deleteConversationData(archive.conversation.id);
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

  /** 从 DeepSeek 导出的临时链接导入：服务端流式解压，客户端分批写 IndexedDB。 */
  const importArchiveUrl = useCallback(
    async (
      url: string,
      onProgress?: (progress: { conversations: number; messages: number }) => void,
    ): Promise<ImportOutcome> => {
      const existing = new Set(conversationsRef.current.map((conversation) => conversation.id));
      let latest: Conversation | null = null;
      const stats = await importArchiveFromUrl(
        url,
        [...existing],
        {
          onConversation: async (conversation) => {
            await importConversationData([conversation], []);
            if (!latest || conversation.updatedAt > latest.updatedAt) latest = conversation;
          },
          onMessages: async (messages) => {
            await importConversationData([], messages);
          },
          onProgress,
        },
      );

      if (latest) {
        const items = await listConversations();
        conversationsRef.current = items;
        setConversations(items);
        await openConversation((latest as Conversation).id);
      }

      return {
        added: stats.conversations,
        skipped: stats.skippedConversations,
        messages: stats.messages,
        skippedMessages: stats.skippedMessages,
        attachments: stats.attachments,
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
      let lastActivityAt = Date.now();

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

      // 用户点停止或上游长时间无数据时，立即结算，不能依赖 fetch abort 一定 reject。
      const settleNow = (reason: "stop" | "timeout") => {
        if (settled) return;
        if (reason === "stop" && pending) {
          acc.content += pending;
          pending = "";
        }
        if (timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
        drainResolve?.();
        drainResolve = null;
        if (reason === "timeout") {
          void finish("error", "生成超时，请稍后重试。");
        } else {
          void finish("stopped");
        }
      };
      settleRef.current = settleNow;
      const watchdog = window.setInterval(() => {
        if (Date.now() - lastActivityAt > 90_000) {
          controller.abort();
          settleNow("timeout");
        }
      }, 10_000);

      const finish = async (
        status: "done" | "refused" | "stopped" | "error",
        error?: string,
        meta?: { code?: string; requestId?: string },
      ) => {
        if (settled) return;
        settled = true;
        settleRef.current = null;
        window.clearInterval(watchdog);
        if (deletedIdsRef.current.has(conversation.id)) {
          abortRef.current = null;
          return;
        }
        window.clearInterval(watchdog);
        if (timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
        abortRef.current = null;

        const final: Message = {
          ...assistantMessage,
          content: acc.content,
          reasoning: acc.reasoning || undefined,
          files: options.files,
          webSearch: options.webSearch,
          sources: acc.sources.length > 0 ? acc.sources : undefined,
          status,
          error,
          errorCode: meta?.code,
          errorRequestId: meta?.requestId,
        };
        const isActive = activeRef.current === conversation.id;
        if (isActive) {
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
        }

        try {
          await putMessage(final);
          if (isActive) {
            const base =
              conversationsRef.current.find((item) => item.id === conversation.id) ?? conversation;
            await updateConversation({
              ...base,
              rootMessageId: rootRef.current,
              updatedAt: Date.now(),
            });
          }
        } catch (error) {
          console.error("写入本地聊天记录失败", error);
          setStorageError("本地存储写入失败，可能是空间不足或无痕模式，聊天记录可能无法保留。");
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
            lastActivityAt = Date.now();
            acc.sources = sources;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessage.id ? { ...message, sources } : message,
              ),
            );
          },
          onDelta: (chunk) => {
            lastActivityAt = Date.now();
            pending += chunk;
            ensureTimer();
          },
          onReasoning: (chunk) => {
            lastActivityAt = Date.now();
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
        if (error instanceof Error && error.name === "AbortError") {
          await finish("stopped");
        } else {
          if (error instanceof ChatApiError && error.status === 401) {
            window.dispatchEvent(new CustomEvent("dream:unauthorized"));
          }
          const rawFailure = (error as Error).message || "生成失败，请稍后重试";
          const failure =
            error instanceof ChatApiError && error.code === "CONTENT_FILTERED"
              ? "这段对话触发了模型的内容安全策略，暂时无法继续。请修改最近几条消息，或新建一个会话再试。"
              : /input stream|stream closed|network|load failed|failed to fetch/i.test(rawFailure)
                ? "0x0001 网络连接中断，请重试。"
                : rawFailure;
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
      const requestFiles =
        options.files && options.files.length > 0 ? options.files : inheritedFiles(visible);
      await runReply(conversation as Conversation, assistantMessage, history, {
        ...options,
        files: requestFiles,
      });
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

  /** 重新生成助手回复：在同一用户消息下挂一个新的兄弟版本。 */
  const regenerate = useCallback(
    async (assistantMessageId: string) => {
      if (streamingRef.current) return;
      const conversationId = activeRef.current;
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversationId || !conversation) return;
      const visible = messagesRef.current;
      const index = visible.findIndex((message) => message.id === assistantMessageId);
      const target = visible[index];
      if (!target || target.role !== "assistant" || !target.parentId) return;

      const all = allMessagesRef.current;
      const path: Message[] = [];
      let cursor = all.find((message) => message.id === target.parentId);
      while (cursor) {
        path.unshift(cursor);
        cursor = cursor.parentId ? all.find((message) => message.id === cursor?.parentId) : undefined;
      }
      if (path.length === 0 || path.at(-1)?.role !== "user") return;

      const newAssistant: Message = {
        id: newId(),
        conversationId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: Date.now(),
        parentId: target.parentId,
        selectedChildId: null,
      };

      const nextAll = [
        ...all.map((message) =>
          message.id === target.parentId ? { ...message, selectedChildId: newAssistant.id } : message,
        ),
        newAssistant,
      ];
      allMessagesRef.current = nextAll;
      setAllMessages(nextAll);

      const nextVisible = [...visible.slice(0, index), newAssistant];
      messagesRef.current = nextVisible;
      setMessages(nextVisible);
      await putMessage(newAssistant);

      await runReply(conversation, newAssistant, historyFor(path), {
        files: target.files,
        webSearch: target.webSearch,
      });
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
    storageError,
    setThinking,
    sendMessage,
    editMessage,
    regenerate,
    selectMessageVersion,
    stop,
    newChat,
    openConversation,
    removeConversation,
    importHistory,
    importShare,
    importArchiveUrl,
  };
}
