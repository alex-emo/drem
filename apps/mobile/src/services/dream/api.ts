import { ApiError } from '../api/client.js'
import { readServerSentEvents } from '../api/sse.js'
import type {
  CreateMessageRequest,
  MessageParam,
  MessageStreamEvent,
  StopReason,
} from '../api/types.js'
import { apiBase, getToken } from './auth.js'

/** 把 Anthropic 风格的消息内容拍平成纯文本；图片/思考块不参与本端文本上下文。 */
const flattenContent = (content: MessageParam['content']): string => {
  if (typeof content === 'string') return content.trim()
  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

const toDreamMessages = (body: CreateMessageRequest): { role: 'user' | 'assistant' | 'system'; content: string }[] => {
  const messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = []
  const system = body.system?.trim()
  if (system) messages.push({ role: 'system', content: system })
  for (const message of body.messages) {
    // latest_reminder 是 DeepSeek 客户端注入的上下文提示，Dream 服务端不识别该角色。
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const content = flattenContent(message.content)
    if (content) messages.push({ role: message.role, content })
  }
  return messages
}

const titleFor = (body: CreateMessageRequest): string | undefined => {
  if (!body.title?.enabled) return undefined
  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = body.messages[index]
    if (message.role !== 'user') continue
    const text = flattenContent(message.content).replace(/\s+/g, ' ').trim()
    if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text
  }
  return undefined
}

const stopReasonFor = (finishReason: string | undefined, refused: boolean): StopReason => {
  if (refused || finishReason === 'content_filter') return 'refusal'
  if (finishReason === 'length') return 'max_tokens'
  return 'end_turn'
}

const readError = async (response: Response): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || response.statusText || '请求失败'
  try {
    const payload = JSON.parse(text) as { error?: { message?: string } }
    if (payload?.error?.message) message = payload.error.message
  } catch {
    // 非 JSON 响应直接使用原文
  }
  if (response.status === 401) {
    clearStoredSession()
    window.dispatchEvent(new Event('dream:unauthorized'))
  }
  return new ApiError('http', message, response.status)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const COMPRESS_THRESHOLD = 256 * 1024

/** 长会话请求体较大时 gzip，弱网上传更稳；小请求直接发送。 */
async function encodeJsonBody(value: unknown): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  const text = JSON.stringify(value)
  if (text.length < COMPRESS_THRESHOLD || typeof CompressionStream === 'undefined') {
    return { body: text, headers: {} }
  }
  const compressed = await new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  return { body: compressed, headers: { 'content-encoding': 'gzip' } }
}

const clearStoredSession = () => {
  try {
    localStorage.removeItem('dream:token')
    localStorage.removeItem('dream:user')
  } catch {
    // 忽略
  }
}

/**
 * 用 Dream 服务端的 `/api/v1/chat` 流，产出 DeepSeek 客户端所需的 Anthropic 风格事件。
 * 思考先于正文；拒绝按普通文本块返回，stop_reason=refusal。
 */
export async function* streamDreamMessage(
  _apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
): AsyncGenerator<MessageStreamEvent> {
  const token = getToken()
  if (!token) {
    throw new ApiError('http', '请先登录 Dream', 401)
  }
  const messages = toDreamMessages(body)
  if (!messages.some((message) => message.role === 'user')) {
    throw new ApiError('protocol', '没有可发送的用户消息')
  }
  let response: Response
  try {
    const encoded = await encodeJsonBody({ messages, thinking: body.thinking.type === 'enabled' })
    response = await fetch(`${apiBase()}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        ...encoded.headers,
      },
      body: encoded.body,
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readError(response)
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw new ApiError('protocol', '服务端没有返回事件流')
  }

  const title = titleFor(body)
  let started = false
  let refused = false
  let thinkingIndex: number | null = null
  let textIndex: number | null = null
  let nextIndex = 0
  let thinkingOpen = false
  let textOpen = false
  let pendingText = ""

  const startMessage = (id: string, model: string): MessageStreamEvent => ({
    type: 'message_start',
    message: { id, model, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  })

  for await (const { event, data } of readServerSentEvents(response.body, signal)) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      continue
    }
    if (event === 'start') {
      started = true
      yield startMessage(
        String(payload.requestId ?? ''),
        String(payload.model ?? body.model),
      )
      continue
    }
    if (!started) {
      started = true
      yield startMessage('', body.model)
    }
    if (event === 'thinking') {
      const delta = typeof payload.delta === 'string' ? payload.delta : ''
      if (!delta) continue
      if (thinkingIndex === null) {
        thinkingIndex = nextIndex
        nextIndex += 1
        thinkingOpen = true
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: delta },
      }
      continue
    }
    if (event === 'delta') {
      const delta = typeof payload.delta === 'string' ? payload.delta : ''
      if (!delta) continue
      if (thinkingOpen && thinkingIndex !== null) {
        thinkingOpen = false
        yield { type: 'content_block_stop', index: thinkingIndex }
      }
      if (textIndex === null) {
        textIndex = nextIndex
        nextIndex += 1
        textOpen = true
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      // 隧道会把 SSE 攒成一批；这里按节拍把文本摊开，避免一次跳一大段。
      pendingText += delta
      while (pendingText) {
        const take = pendingText.length > 160 ? 8 : pendingText.length > 60 ? 6 : 4
        const piece = pendingText.slice(0, take)
        pendingText = pendingText.slice(take)
        yield {
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: piece },
        }
        if (pendingText) await sleep(30)
      }
      continue
    }
    if (event === 'refusal') {
      refused = true
      const message = typeof payload.message === 'string' ? payload.message : ''
      if (thinkingOpen && thinkingIndex !== null) {
        thinkingOpen = false
        yield { type: 'content_block_stop', index: thinkingIndex }
      }
      if (textIndex === null) {
        textIndex = nextIndex
        nextIndex += 1
        textOpen = true
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      if (message) {
        yield {
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: message },
        }
      }
      continue
    }
    if (event === 'done') {
      if (thinkingOpen && thinkingIndex !== null) {
        thinkingOpen = false
        yield { type: 'content_block_stop', index: thinkingIndex }
      }
      if (textOpen && textIndex !== null) {
        textOpen = false
        yield { type: 'content_block_stop', index: textIndex }
      }
      const stopReason = stopReasonFor(
        typeof payload.finishReason === 'string' ? payload.finishReason : undefined,
        refused,
      )
      yield {
        type: 'message_delta',
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
          ...(stopReason === 'refusal'
            ? { stop_details: { type: 'refusal' as const, category: null, explanation: null } }
            : {}),
          ...(title && stopReason === 'end_turn' ? { title } : {}),
        },
      }
      yield { type: 'message_stop' }
      return
    }
    if (event === 'error') {
      const error = payload.error as { message?: string } | undefined
      throw new ApiError('stream', error?.message ?? '生成失败，请稍后重试')
    }
  }

  // 流意外结束：补齐块与结束事件，避免 UI 一直处于生成中。
  if (thinkingOpen && thinkingIndex !== null) yield { type: 'content_block_stop', index: thinkingIndex }
  if (textOpen && textIndex !== null) yield { type: 'content_block_stop', index: textIndex }
  yield {
    type: 'message_delta',
    delta: {
      stop_reason: refused ? 'refusal' : 'end_turn',
      stop_sequence: null,
      ...(refused
        ? { stop_details: { type: 'refusal' as const, category: null, explanation: null } }
        : {}),
    },
  }
  yield { type: 'message_stop' }
}
