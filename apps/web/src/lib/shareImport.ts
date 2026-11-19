import { fetchSharedChat } from "./api";
import type { Conversation, Message } from "./types";
import { makeTitle } from "./utils";

export interface ImportedShare {
  conversation: Conversation;
  messages: Message[];
  attachments: number;
}

/** 通过 Dream Server 拉取 DeepSeek 分享链接，转成与本地库一致的会话与消息。 */
export async function buildShareImport(url: string): Promise<ImportedShare> {
  const data = await fetchSharedChat(url);

  const firstUser = data.messages.find((message) => message.role === "user" && message.content.trim());
  const title =
    data.title.trim() && data.title !== "Shared Conversation"
      ? data.title.trim()
      : makeTitle(firstUser?.content.trim() || "分享对话");

  const base = data.messages[0]?.createdAt ?? Date.now();
  const conversation: Conversation = {
    id: `ds-share-${data.shareId}`,
    title,
    createdAt: base,
    updatedAt: data.messages[data.messages.length - 1]?.createdAt ?? base,
  };

  const messages: Message[] = data.messages.map((message, index) => ({
    id: `${conversation.id}-${index + 1}`,
    conversationId: conversation.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning || undefined,
    status: message.status,
    error:
      message.status === "error"
        ? "这条回复在 DeepSeek 客户端中生成失败或超长中断。"
        : undefined,
    createdAt: base + index,
  }));

  return { conversation, messages, attachments: data.attachments };
}
