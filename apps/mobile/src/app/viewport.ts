import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Keyboard, KeyboardResize, type KeyboardInfo } from '@capacitor/keyboard'
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

/** 窄于 768px 按移动端布局 */
const query = window.matchMedia('not all and (min-width: 768px)')

const subscribe = (onChange: () => void) => {
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const useIsMobile = () => useSyncExternalStore(subscribe, () => query.matches)

const preventPageScroll = (event: TouchEvent) => {
  if (event.touches.length !== 1) {
    return
  }
  for (
    let element = event.target instanceof Element ? event.target : null;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element)
    const scrollsY =
      /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight
    const scrollsX =
      /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth
    if (scrollsY || scrollsX) {
      return
    }
  }
  event.preventDefault()
}

/** 阻止移动端整页滚动，保留内部可滚动区域的滚动和双指缩放。 */
export const usePreventPageScroll = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    document.addEventListener('touchmove', preventPageScroll, { passive: false })
    return () => document.removeEventListener('touchmove', preventPageScroll)
  }, [enabled])
}

/**
 * 原生键盘策略：iOS 让系统缩短 WebView（native），而不是自己滚动整页；
 * Android 保持 windowSoftInputMode=adjustResize 的现有行为。
 */
export const setupNativeKeyboard = () => {
  if (!Capacitor.isNativePlatform()) {
    return
  }
  // iPhone 键盘上方的工具栏会挤占聊天输入区，聊天场景不需要。
  void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined)
  if (Capacitor.getPlatform() === 'ios') {
    void Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => undefined)
  }
}

/** 移动端页面跟随视觉视口，键盘弹出后顶栏和输入框仍留在可见区域。 */
export const useMobileViewport = (enabled: boolean) => {
  const frameRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!enabled || !frame) {
      return
    }
    const viewport = window.visualViewport
    const inputSelector = 'textarea, input:not([type="file"])'
    let animationFrame = 0
    let keyboardHeight = 0
    let keyboardVisible = false
    const timers: number[] = []
    const handles: PluginListenerHandle[] = []
    let disposed = false

    const reset = () => {
      frame.style.removeProperty('--app-viewport-height')
      frame.style.removeProperty('--app-viewport-top')
    }
    const clearTimers = () => {
      while (timers.length > 0) {
        window.clearTimeout(timers.pop())
      }
    }
    const update = () => {
      // 双指缩放由浏览器处理，保持当前布局尺寸。
      if (viewport && viewport.scale !== 1) {
        return
      }
      // 失焦后直接恢复 CSS 的全高布局，不等 Safari 收键盘后的 resize。
      if (!document.activeElement?.matches(inputSelector)) {
        reset()
        return
      }
      const innerHeight = window.innerHeight
      const visualHeight = viewport?.height ?? innerHeight
      let height = Math.min(visualHeight, innerHeight)
      // Android 的 adjustResize 和 iOS 的 native 模式会缩短 innerHeight；
      // 若某些 WKWebView 全屏场景没有缩短，则用键盘事件高度兜底，避免输入框被键盘盖住。
      if (keyboardVisible && keyboardHeight > 0 && height > innerHeight - keyboardHeight + 4) {
        height = Math.max(0, innerHeight - keyboardHeight)
      }
      frame.style.setProperty('--app-viewport-height', `${height}px`)
      frame.style.setProperty('--app-viewport-top', `${viewport?.offsetTop ?? 0}px`)
    }
    const scheduleFrame = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(update)
    }
    const schedule = () => {
      // 先同步跟上键盘动画，下一帧再校准系统延迟更新的视口读数。
      update()
      scheduleFrame()
    }
    const onKeyboard = (height: number) => {
      keyboardHeight = Math.max(0, height)
      keyboardVisible = keyboardHeight > 0
      frame.classList.toggle('keyboard-open', keyboardVisible)
      if (keyboardVisible) {
        // 键盘弹出时取消 home indicator 的安全区留白，避免输入框与键盘之间多一条空白。
        frame.style.setProperty('--app-safe-bottom', '0px')
      } else {
        frame.style.removeProperty('--app-safe-bottom')
      }
      schedule()
      if (keyboardVisible) {
        clearTimers()
        // 原生 WebView resize 在键盘动画结束后才完成，延迟再校准两次。
        timers.push(window.setTimeout(schedule, 260))
        timers.push(window.setTimeout(schedule, 520))
      }
    }
    const pushHandle = (handle: PluginListenerHandle) => {
      if (disposed) {
        void handle.remove()
      } else {
        handles.push(handle)
      }
    }
    const onFocusIn = () => {
      if (document.activeElement?.matches(inputSelector)) {
        schedule()
      }
    }

    if (Capacitor.isNativePlatform()) {
      const onShow = (info: KeyboardInfo) => onKeyboard(info.keyboardHeight)
      const onHide = () => onKeyboard(0)
      void Keyboard.addListener('keyboardWillShow', onShow).then(pushHandle, () => undefined)
      void Keyboard.addListener('keyboardDidShow', onShow).then(pushHandle, () => undefined)
      void Keyboard.addListener('keyboardWillHide', onHide).then(pushHandle, () => undefined)
      void Keyboard.addListener('keyboardDidHide', onHide).then(pushHandle, () => undefined)
    }

    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', onFocusIn)
    // 等点击和焦点切换完成，避免按钮移动、或切换输入框时短暂恢复全高。
    document.addEventListener('focusout', scheduleFrame)
    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      clearTimers()
      for (const handle of handles) {
        void handle.remove()
      }
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', scheduleFrame)
      frame.classList.remove('keyboard-open')
      frame.style.removeProperty('--app-safe-bottom')
      reset()
    }
  }, [enabled])

  return frameRef
}
