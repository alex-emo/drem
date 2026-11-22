import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { LoginScreen } from '../components/auth/LoginScreen.js'
import { clearSession, getToken } from '../services/dream/auth.js'
import { setApiKey } from '../services/settings.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { installApk } from '../services/dream/installer.js'
import { APP_VERSION, compareVersion, fetchServerVersion, type ServerVersion } from '../services/dream/update.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { Modal } from '../components/base/Modal.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider, openMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const [authed, setAuthed] = useState(() => Boolean(getToken()))
  const [update, setUpdate] = useState<ServerVersion | null>(null)

  useEffect(() => {
    if (!authed) return
    void fetchServerVersion().then((info) => {
      if (info && compareVersion(info.version, APP_VERSION) > 0) setUpdate(info)
    })
  }, [authed])

  usePreventPageScroll(isMobile)

  // 从屏幕左缘右滑打开抽屉，抽屉内左滑关闭（DS App 的手势习惯）
  useEffect(() => {
    if (!isMobile) return
    let startX = 0
    let startY = 0
    let tracking = false
    const onStart = (event: TouchEvent) => {
      if (useMobileSider.getState().open || event.touches.length !== 1) return
      const touch = event.touches[0]
      const target = event.target as Element | null
      // 全屏右滑打开抽屉；代码块和输入区域的横向手势优先保留
      if (
        target?.closest(
          "pre, code, textarea, input, select, [contenteditable='true'], .code-block",
        )
      ) {
        tracking = false
        return
      }
      tracking = true
      startX = touch.clientX
      startY = touch.clientY
    }
    const onMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return
      const touch = event.touches[0]
      if (touch.clientX - startX > 56 && Math.abs(touch.clientY - startY) < 48) {
        tracking = false
        openMobileSider()
      }
    }
    const onEnd = () => {
      tracking = false
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [isMobile])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    if (!authed) return
    setApiKey(getToken())
    void initChat()
  }, [authed])

  useEffect(() => {
    const onUnauthorized = () => {
      clearSession()
      setApiKey(null)
      setAuthed(false)
    }
    window.addEventListener('dream:unauthorized', onUnauthorized)
    return () => window.removeEventListener('dream:unauthorized', onUnauthorized)
  }, [])

  if (!authed) {
    return <LoginScreen onSuccess={() => setAuthed(true)} />
  }

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <Toast />
      {update ? (
        <Modal
          title="发现新版本"
          closable
          onClose={() => setUpdate(null)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setUpdate(null)}>
                以后再说
              </Button>
              <Button
                variant="primary"
                size="m"
                onClick={() => {
                  const downloadUrl = /^https?:\/\//.test(update.apkUrl)
                    ? update.apkUrl
                    : new URL(update.apkUrl, __API_ORIGIN__).toString()
                  void installApk(downloadUrl)
                    .then((installed) => {
                      if (!installed) window.open(downloadUrl, '_blank')
                    })
                    .catch((error: unknown) => {
                      const message = error instanceof Error ? error.message : String(error)
                      if (message.includes('允许')) {
                        window.alert('请在系统设置中允许 Dream 安装应用，然后重新点击「立即更新」。')
                      } else {
                        window.open(downloadUrl, '_blank')
                      }
                    })
                  setUpdate(null)
                }}
              >
                立即更新
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.6 }}>
            <div>
              Dream {update.version}
              <span style={{ opacity: 0.6, marginLeft: 8 }}>当前 {APP_VERSION}</span>
            </div>
            <div style={{ fontSize: 13, opacity: 0.72 }}>
              更新会覆盖安装，聊天记录不会丢失；请不要先卸载旧版本。卸载会清除本机聊天记录。
            </div>
            <div style={{ opacity: 0.75 }}>{update.notes ?? '修复问题并提升稳定性。'}</div>
            <div style={{ opacity: 0.6, fontSize: 12 }}>
              下载完成后按系统提示安装；安装完成重新打开 App 即为新版本。
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
