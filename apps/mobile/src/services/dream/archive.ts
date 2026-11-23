import type { AssistantMessage, Message, Session, UserMessage } from '../chat/types.js'
import { normalizeSession } from '../chat/branches.js'
import { appendSession } from '../chat/store.js'
import { apiBase, getToken } from './auth.js'

export interface ArchiveStats {
  conversations: number
  messages: number
  skippedConversations: number
  skippedMessages: number
  attachments: number
}

interface ServerConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

interface ServerMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  status: 'done' | 'error'
  error?: string
  createdAt: number
}

export class ArchiveImportError extends Error {}

function toSession(conversation: ServerConversation, source: ServerMessage[]): Session {
  let parentId: string | null = null
  const messages: Message[] = source.map((item) => {
    if (item.role === 'user') {
      const message: UserMessage = {
        id: item.id,
        role: 'user',
        content: item.content,
        files: [],
        createdAt: item.createdAt,
        parentId,
      }
      parentId = item.id
      return message
    }
    const blocks: AssistantMessage['blocks'] = []
    if (item.reasoning?.trim()) blocks.push({ type: 'thinking', thinking: item.reasoning })
    if (item.content.trim()) blocks.push({ type: 'text', text: item.content })
    const message: AssistantMessage = {
      id: item.id,
      role: 'assistant',
      createdAt: item.createdAt,
      parentId,
      model: null,
      thinking: false,
      search: false,
      prefix: false,
      status: item.status === 'error' ? 'error' : 'done',
      blocks,
    }
    parentId = item.id
    return message
  })

  return normalizeSession({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages,
    rootMessageId: messages[0]?.id ?? null,
  })
}

/** 服务端流式下载并解压导出 ZIP，客户端按会话增量写入 chat-demo 的 IndexedDB。 */
export async function importArchiveFromUrl(
  url: string,
  skipIds: string[],
  onProgress?: (progress: { conversations: number; messages: number }) => void,
): Promise<ArchiveStats> {
  const token = getToken()
  if (!token) throw new ArchiveImportError('请先登录')
  const response = await fetch(`${apiBase()}/import/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ url, skipIds }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new ArchiveImportError(body?.error?.message ?? `导入失败（${response.status}）`)
  }
  if (!response.body) throw new ArchiveImportError('导入响应为空')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let current: { conversation: ServerConversation; messages: ServerMessage[] } | null = null
  let conversations = 0
  let messages = 0
  let final: ArchiveStats | null = null

  const flush = async () => {
    if (!current) return
    if (current.messages.length > 0) {
      await appendSession(toSession(current.conversation, current.messages))
      conversations += 1
      messages += current.messages.length
      onProgress?.({ conversations, messages })
    }
    current = null
  }

  const handle = async (line: string) => {
    if (!line.trim()) return
    let payload: {
      type?: string
      conversation?: ServerConversation
      messages?: ServerMessage[]
      stats?: ArchiveStats
      message?: string
    }
    try {
      payload = JSON.parse(line) as typeof payload
    } catch {
      return
    }
    if (payload.type === 'conversation' && payload.conversation) {
      await flush()
      current = { conversation: payload.conversation, messages: [] }
    } else if (payload.type === 'messages' && payload.messages && current) {
      current.messages.push(...payload.messages)
    } else if (payload.type === 'done' && payload.stats) {
      final = payload.stats
    } else if (payload.type === 'error') {
      const hex = (payload as { hex?: string }).hex ?? '0x5001'
      throw new ArchiveImportError(`${hex} ${payload.message ?? '导入过程中发生错误'}`)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        await handle(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) await handle(buffer)
    await flush()
  } finally {
    reader.releaseLock()
  }

  return final ?? { conversations, messages, skippedConversations: 0, skippedMessages: 0, attachments: 0 }
}
