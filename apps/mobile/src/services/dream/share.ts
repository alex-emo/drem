import type { AssistantMessage, Message, Session, UserMessage } from '../chat/types.js'
import { normalizeSession } from '../chat/branches.js'
import { apiBase, getToken } from './auth.js'

export interface SharedChatMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  status: 'done' | 'error'
  createdAt: number
}

export interface SharedChat {
  shareId: string
  title: string
  attachments: number
  messages: SharedChatMessage[]
}

export class ShareImportError extends Error {}

/** 让 Dream Server 代取 DeepSeek 分享内容（手机端无法跨域直连 chat.deepseek.com）。 */
export async function fetchSharedChat(url: string): Promise<SharedChat> {
  const token = getToken()
  if (!token) throw new ShareImportError('请先登录')
  const response = await fetch(`${apiBase()}/import/share?url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new ShareImportError(body?.error?.message ?? `导入失败（${response.status}）`)
  }
  return (await response.json()) as SharedChat
}

const isDeepSeekShare = (url: string) =>
  /^https?:\/\/chat\.deepseek\.com\/share\/[A-Za-z0-9_-]+\/?$/.test(url.trim())

/** 把分享消息转成 chat-demo 的本地会话结构；只导入当前分支的文本与思考。 */
export function buildShareSession(chat: SharedChat): Session {
  const id = `ds-share-${chat.shareId}`
  const base = chat.messages[0]?.createdAt ?? Date.now()
  const firstUser = chat.messages.find((m) => m.role === 'user' && m.content.trim())
  const title =
    chat.title.trim() && chat.title !== 'Shared Conversation'
      ? chat.title.trim()
      : (firstUser?.content.trim() || '分享对话').slice(0, 24)

  let parentId: string | null = null
  const messages: Message[] = []
  chat.messages.forEach((item, index) => {
    const messageId = `${id}-${index + 1}`
    const createdAt = base + index
    if (item.role === 'user') {
      const message: UserMessage = {
        id: messageId,
        role: 'user',
        content: item.content,
        files: [],
        createdAt,
        parentId,
      }
      messages.push(message)
    } else {
      const blocks: AssistantMessage['blocks'] = []
      if (item.reasoning?.trim()) blocks.push({ type: 'thinking', thinking: item.reasoning })
      if (item.content.trim()) blocks.push({ type: 'text', text: item.content })
      const message: AssistantMessage = {
        id: messageId,
        role: 'assistant',
        createdAt,
        parentId,
        model: null,
        thinking: false,
        search: false,
        prefix: false,
        status: item.status === 'error' ? 'error' : 'done',
        blocks,
      }
      messages.push(message)
    }
    parentId = messageId
  })

  return normalizeSession({
    id,
    title,
    createdAt: base,
    updatedAt: base + Math.max(chat.messages.length - 1, 0),
    messages,
    rootMessageId: messages[0]?.id ?? null,
  })
}

export { isDeepSeekShare }
