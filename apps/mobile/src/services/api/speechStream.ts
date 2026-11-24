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
    // 服务端会在连接后立即向上游发起 run-task，ready 由服务端事件驱动。
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
      }
    },
    finish: () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'finish' }))
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
