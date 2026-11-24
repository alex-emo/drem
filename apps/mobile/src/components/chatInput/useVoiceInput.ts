import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslationMessage } from '../../i18n/index.js'
import { openSpeechStream, type SpeechStream } from '../../services/api/speechStream.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'

export type VoiceInputStatus = 'idle' | 'preparing' | 'recording' | 'finishing'

/** 流式识别上限；服务端最大 90 秒，这里留一点余量。 */
const MAX_RECORDING_SECONDS = 60

const AVAILABLE = typeof window === 'undefined' || window.isSecureContext

const describeRecordingError = (error: unknown): TranslationMessage => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return { key: 'voiceInputPermissionDenied' }
    }
    if (error.name === 'NotFoundError') {
      return { key: 'voiceInputNoDevice' }
    }
  }
  return { key: 'voiceInputFailed' }
}

/**
 * 按住说话：按下后建立流式识别并开始录音，边说边出字；
 * 松手结束录音，等待最终结果并插入输入框；上滑取消。
 */
export const useVoiceInput = (onText: (text: string) => void) => {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [partial, setPartial] = useState('')
  const recordingRef = useRef<Recording | null>(null)
  const streamRef = useRef<SpeechStream | null>(null)
  const operationRef = useRef(0)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const cleanup = useCallback(() => {
    recordingRef.current?.cancel()
    recordingRef.current = null
    streamRef.current?.cancel()
    streamRef.current = null
  }, [])

  const reset = useCallback(() => {
    cleanup()
    setPartial('')
    setStatus('idle')
  }, [cleanup])

  const cancelHold = useCallback(() => {
    operationRef.current++
    reset()
  }, [reset])

  const endHold = useCallback(async () => {
    const recording = recordingRef.current
    const stream = streamRef.current
    if (!recording || !stream) {
      // 尚在等权限/连接时松手：直接取消，不留下迟到的录音。
      if (status === 'preparing') {
        cancelHold()
      }
      return
    }
    const operation = operationRef.current
    recordingRef.current = null
    streamRef.current = null
    setStatus('finishing')
    try {
      await recording.stop()
    } catch {
      // 停止失败仍尝试拿最终结果。
    }
    try {
      const text = await stream.finish()
      if (operationRef.current !== operation) return
      const trimmed = text.trim()
      if (trimmed) {
        onTextRef.current(trimmed)
      } else {
        showToast({ key: 'voiceInputEmpty' })
      }
    } catch {
      if (operationRef.current === operation) {
        showToast({ key: 'voiceInputFailed' })
      }
    } finally {
      if (operationRef.current === operation) {
        setPartial('')
        setStatus('idle')
      }
    }
  }, [cancelHold, status])

  const startHold = useCallback(async () => {
    if (!AVAILABLE || status !== 'idle') {
      return
    }
    const token = useSettings.getState().apiKey
    if (!token) {
      showToast({ key: 'voiceInputFailed' })
      return
    }
    const operation = ++operationRef.current
    setPartial('')
    setStatus('preparing')
    const stream = openSpeechStream(token, {
      onPartial: (text) => {
        if (operationRef.current === operation) {
          setPartial(text)
        }
      },
    })
    streamRef.current = stream
    try {
      await stream.ready
      if (operationRef.current !== operation) {
        stream.cancel()
        return
      }
      const recording = await startRecording(
        () => {
          if (operationRef.current === operation) {
            showToast({ key: 'voiceInputLimitReached' })
            void endHold()
          }
        },
        (chunk) => {
          if (operationRef.current === operation) {
            stream.sendAudio(chunk)
          }
        }
      )
      if (operationRef.current !== operation) {
        recording.cancel()
        return
      }
      recordingRef.current = recording
      setStatus('recording')
    } catch (error) {
      if (operationRef.current === operation) {
        stream.cancel()
        streamRef.current = null
        setStatus('idle')
        showToast(describeRecordingError(error))
      }
    }
  }, [status, endHold])

  useEffect(() => {
    if (status !== 'recording') {
      return
    }
    const timer = setTimeout(() => {
      showToast({ key: 'voiceInputLimitReached' })
      void endHold()
    }, MAX_RECORDING_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [status, endHold])

  useEffect(
    () => () => {
      operationRef.current++
      cleanup()
    },
    [cleanup]
  )

  const getAnalyser = useCallback(() => recordingRef.current?.analyser ?? null, [])

  return {
    status,
    partial,
    getAnalyser,
    startHold,
    endHold,
    cancelHold,
    available: AVAILABLE,
  }
}
