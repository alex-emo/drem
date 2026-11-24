import { API_ORIGIN } from './client.js'

export type SpeechStreamHandlers = {
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (message: string) => void
}

export type SpeechStream = {
  /** 服务端 task-started 后 resolve；之前发送的音频会由服务端排队。 */
  ready: Promise<void>
  sendAudio: (chunk: Uint8Array) => void
  finish: () => Promise<string>
  cancel: () => void
}

type ServerEvent =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message?: string }

const wsUrl = () => {
  const url = new URL(API_ORIGIN)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/api/v1/asr/ws'
  url.search = ''
  return url.toString()
}

/**
 * 服务端流式 ASR：WebSocket 子协议携带 session token。
 * 音频为 16 kHz / 单声道 / 16-bit little-endian PCM 原始字节。
 */
export const openSpeechStream = (
  token: string,
  handlers: SpeechStreamHandlers = {}
): SpeechStream => {
  const socket = new WebSocket(wsUrl(), ['dream.asr', token])
  socket.binaryType = 'arraybuffer'

  let resolveReady: () => void = () => {}
  let rejectReady: (error: Error) => void = () => {}
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  let finalText = ''
  let resolveFinal: (text: string) => void = () => {}
  let rejectFinal: (error: Error) => void = () => {}
  const final = new Promise<string>((resolve, reject) => {
    resolveFinal = resolve
    rejectFinal = reject
  })

  let settled = false
  const queued: Uint8Array[] = []
  let queuedBytes = 0
  const flush = () => {
    while (queued.length > 0 && socket.readyState === WebSocket.OPEN) {
      const chunk = queued.shift()
      if (chunk) socket.send(chunk)
    }
  }
  const fail = (message: string, error = new Error(message)) => {
    if (settled) return
    settled = true
    handlers.onError?.(message)
    rejectReady(error)
    rejectFinal(error)
    try {
      socket.close()
    } catch {
      // ignore
    }
  }

  socket.onopen = () => {
    // 连接建立前的音频先缓存，避免用户开始说话时丢字。
    flush()
  }
  socket.onerror = () => {
    fail('语音识别连接失败，请稍后重试。')
  }
  socket.onclose = () => {
    if (!settled) {
      settled = true
      const error = new Error('语音识别连接已断开')
      rejectReady(error)
      rejectFinal(error)
    }
  }
  socket.onmessage = (event) => {
    let payload: ServerEvent
    try {
      payload = JSON.parse(String(event.data)) as ServerEvent
    } catch {
      return
    }
    if (payload.type === 'ready') {
      resolveReady()
      return
    }
    if (payload.type === 'partial') {
      handlers.onPartial?.(payload.text)
      return
    }
    if (payload.type === 'final') {
      finalText = payload.text
      settled = true
      handlers.onFinal?.(payload.text)
      resolveFinal(payload.text)
      try {
        socket.close()
      } catch {
        // ignore
      }
      return
    }
    if (payload.type === 'error') {
      fail(payload.message || '语音识别失败，请稍后再试。')
    }
  }

  return {
    ready,
    sendAudio: (chunk) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(chunk)
        return
      }
      if (socket.readyState !== WebSocket.CONNECTING) return
      // 最多缓存 2 MiB；超出时直接断开，避免无限占用内存。
      if (queuedBytes + chunk.byteLength > 2 * 1024 * 1024) {
        fail('语音识别连接超时，请稍后重试。')
        return
      }
      queued.push(chunk.slice())
      queuedBytes += chunk.byteLength
    },
    finish: () => {
      const sendFinish = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'finish' }))
        }
      }
      if (socket.readyState === WebSocket.OPEN) {
        sendFinish()
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener('open', sendFinish, { once: true })
      }
      return final.then((text) => text || finalText)
    },
    cancel: () => {
      settled = true
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'cancel' }))
        }
        socket.close()
      } catch {
        // ignore
      }
    },
  }
}
