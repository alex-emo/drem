import clsx from 'clsx'
import { useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconMicFill16, IconMicOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import type { VoiceInputStatus } from './useVoiceInput.js'
import styles from './VoiceButton.module.css'

/**
 * 按住说话按钮：按下开始流式识别，松手结束；上滑超过 60px 取消。
 * 录音中显示品牌色光环，识别中的文字由输入框区域展示。
 */
export const VoiceButton = ({
  status,
  disabled = false,
  onStart,
  onEnd,
  onCancel,
}: {
  status: VoiceInputStatus
  disabled?: boolean
  onStart: () => void
  onEnd: () => void
  onCancel: () => void
}) => {
  const t = useTranslate()
  const pressingRef = useRef(false)
  const cancelledRef = useRef(false)
  const startYRef = useRef(0)
  const active = status === 'preparing' || status === 'recording'

  const label = disabled
    ? t('voiceInputRequiresHttps')
    : status === 'preparing'
      ? t('voiceInputListening')
      : status === 'recording'
        ? t('voiceInputRelease')
        : status === 'finishing'
          ? t('voiceInputCancel')
          : t('voiceInputHold')

  const release = () => {
    if (!pressingRef.current) return
    pressingRef.current = false
    if (!cancelledRef.current) {
      onEnd()
    }
  }

  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={clsx(styles.button, active && styles.recording, disabled && styles.disabled)}
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (disabled || pressingRef.current) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          pressingRef.current = true
          cancelledRef.current = false
          startYRef.current = event.clientY
          onStart()
        }}
        onPointerMove={(event) => {
          if (!pressingRef.current || cancelledRef.current) return
          if (event.clientY < startYRef.current - 60) {
            cancelledRef.current = true
            onCancel()
          }
        }}
        onPointerUp={(event) => {
          try {
            event.currentTarget.releasePointerCapture(event.pointerId)
          } catch {
            // ignore
          }
          release()
        }}
        onPointerCancel={() => {
          if (pressingRef.current) {
            pressedCancel()
          }
        }}
        onLostPointerCapture={() => {
          if (pressingRef.current) {
            pressedCancel()
          }
        }}
      >
        {active ? (
          <span className={styles.active}>
            <span className={styles.halo} />
            <span className={styles.core} />
            <span className={styles.outline}>
              <IconMicOutline16 />
            </span>
            <span className={styles.glyph}>
              <IconMicFill16 />
            </span>
          </span>
        ) : status === 'finishing' ? (
          <span className={styles.loading} />
        ) : (
          <IconMicOutline16 />
        )}
      </button>
    </Tooltip>
  )

  function pressedCancel() {
    pressingRef.current = false
    cancelledRef.current = true
    onCancel()
  }
}
