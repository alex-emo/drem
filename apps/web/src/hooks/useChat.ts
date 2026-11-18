import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat } from "../lib/api";
import { deleteConversationData, getMessages, listConversations, putConversation, putMessage } from "../lib/db";
import type { Conversation, Message } from "../lib/types";
import { makeTitle, newId } from "../lib/utils";

export type ChatController = ReturnType<typeof useChat>;

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const remember = (id: string | null) => {
    try {
      if (id) localStorage.setItem("dream-active-id", id);
      else localStorage.removeItem("dream-active-id");
    } catch {
      // 忽略隐私模式下的存储错误
    }
  };

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
        const restored = await getMessages(saved);
        if (!alive) return;
        activeRef.current = saved;
        setActiveId(saved);
        setMessages(restored);
        messagesRef.current = restored;
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    messagesRef.current = [];
    remember(null);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const items = await getMessages(id);
    setActiveId(id);
    setMessages(items);
    messagesRef.current = items;
    remember(id);
  }, []);

  const removeConversation = useCallback(async (id: string) => {
    await deleteConversationData(id);
    setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
    if (activeRef.current === id) {
      abortRef.current?.abort();
      setActiveId(null);
      setMessages([]);
      messagesRef.current = [];
      remember(null);
    }
  }, []);

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streamingRef.current) return;

      const now = Date.now();
      let conversationId = activeRef.current;
      let conversation = conversationId
        ? (conversationsRef.current.find((item) => item.id === conversationId) ?? null)
        : null;

      if (!conversationId) {
        conversationId = newId();
        conversation = {
          id: conversationId,
          title: makeTitle(text),
          createdAt: now,
          updatedAt: now,
        };
        await putConversation(conversation);
        setConversations((prev) => [conversation as Conversation, ...prev]);
        setActiveId(conversationId);
        activeRef.current = conversationId;
        remember(conversationId);
      }

      const userMessage: Message = {
        id: newId(),
        conversationId,
        role: "user",
        content: text,
        status: "done",
        createdAt: now,
      };

      const assistantMessage: Message = {
        id: newId(),
        conversationId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: now + 1,
      };

      // 只回传纯文本历史：用户消息 + 已完成的助手消息
      const history = [...messagesRef.current, userMessage]
        .filter(
          (message) =>
            message.role === "user" ||
            (message.role === "assistant" && message.status === "done" && message.content.trim().length > 0),
        )
        .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

      const nextMessages = [...messagesRef.current, userMessage, assistantMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      await putMessage(userMessage);
      await putMessage(assistantMessage);

      setStreaming(true);
      streamingRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      const acc = { content: "", reasoning: "" };
      let settled = false;

      const finish = async (status: "done" | "error", error?: string) => {
        if (settled) return;
        settled = true;
        abortRef.current = null;

        const final: Message = {
          ...assistantMessage,
          content: acc.content,
          reasoning: acc.reasoning || undefined,
          status,
          error,
        };

        messagesRef.current = messagesRef.current.map((message) =>
          message.id === assistantMessage.id ? final : message,
        );
        setMessages((prev) => prev.map((message) => (message.id === assistantMessage.id ? final : message)));
        setStreaming(false);
        streamingRef.current = false;

        try {
          await putMessage(final);
          const base = conversationsRef.current.find((item) => item.id === conversationId) ?? conversation;
          if (base) {
            const updated: Conversation = { ...base, updatedAt: Date.now() };
            await putConversation(updated);
            conversationsRef.current = conversationsRef.current.map((item) =>
              item.id === updated.id ? updated : item,
            );
            setConversations((prev) => {
              const list = prev.map((item) => (item.id === updated.id ? updated : item));
              return list.sort((a, b) => b.updatedAt - a.updatedAt);
            });
          }
        } catch {
          // 本地存储失败不影响界面展示
        }
      };

      try {
        await streamChat({
          messages: history,
          thinking,
          signal: controller.signal,
          onDelta: (chunk) => {
            acc.content += chunk;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessage.id ? { ...message, content: acc.content } : message,
              ),
            );
          },
          onReasoning: (chunk) => {
            acc.reasoning += chunk;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessage.id ? { ...message, reasoning: acc.reasoning } : message,
              ),
            );
          },
        });
        await finish("done");
      } catch (err) {
        const error = err as Error;
        if (error.name === "AbortError") {
          await finish("done");
        } else {
          await finish("error", error.message || "生成失败，请稍后重试");
        }
      }
    },
    [thinking],
  );

  return {
    conversations,
    activeId,
    messages,
    streaming,
    thinking,
    setThinking,
    sendMessage,
    stop,
    newChat,
    openConversation,
    removeConversation,
  };
}
