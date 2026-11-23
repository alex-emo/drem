import { useCallback, useEffect, useState } from 'react'
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
import { BrandMark } from '../components/base/BrandMark.js'
import { maybePushAppCloud, pushAppCloud, unlockAppCloud, type AppCloudState } from '../services/dream/cloud.js'
import { clearSession, getToken } from '../services/dream/auth.js'
import { setApiKey } from '../services/settings.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { installApk } from '../services/dream/installer.js'
import {
  fetchLatestAnnouncement,
  isAnnouncementSeen,
  markAnnouncementSeen,
  type AppAnnouncement,
} from '../services/dream/announcement.js'
import { Capacitor } from '@capacitor/core'
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
  const [cloudPhase, setCloudPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cloudState, setCloudState] = useState<AppCloudState | null>(null)
  const [cloudError, setCloudError] = useState('')
  const [askUpload, setAskUpload] = useState(false)
  const [announcement, setAnnouncement] = useState<AppAnnouncement | null>(null)

  const checkForUpdate = useCallback(() => {
    if (Capacitor.getPlatform() === 'ios') return
    void fetchServerVersion().then((info) => {
      if (info && compareVersion(info.version, APP_VERSION) > 0) setUpdate(info)
    })
  }, [])

  // 只在“用户主动登录成功”时检查更新；冷启动不检查。
  // 已登录状态下启动/回到前台（包括划掉后重开）也检查一次；登录页不检查。
  useEffect(() => {
    if (!authed) return
    checkForUpdate()
  }, [authed, checkForUpdate])

  useEffect(() => {
    if (!authed || cloudPhase !== 'ready') return
    void fetchLatestAnnouncement().then((latest) => {
      if (latest && !isAnnouncementSeen(latest)) setAnnouncement(latest)
    })
  }, [authed, cloudPhase])

  useEffect(() => {
    const onManual = (event: Event) => {
      const detail = (event as CustomEvent).detail as ServerVersion | undefined
      if (detail) setUpdate(detail)
      else checkForUpdate()
    }
    window.addEventListener('dream:check-update', onManual)
    return () => window.removeEventListener('dream:check-update', onManual)
  }, [checkForUpdate])

  usePreventPageScroll(isMobile)

  // 首帧成功渲染后再移除启动兜底层；渲染崩溃时保留兜底层与错误页。
  useEffect(() => {
    ;(window as unknown as { __dreamBooted?: boolean }).__dreamBooted = true
    document.getElementById('boot')?.remove()
  }, [])

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
  useEffect(() => {
    if (!cloudState?.backup || cloudState.localSessions === 0) return
    if (localStorage.getItem('dream-app-upload-declined') === '1') return
    if (localStorage.getItem('dream-app-upload-pending') === '1') return
    const timer = window.setTimeout(() => void pushAppCloud().catch(() => undefined), 3000)
    return () => window.clearTimeout(timer)
  }, [cloudState])
  useEffect(() => {
    const timer = window.setInterval(() => void maybePushAppCloud(), 60 * 1000)
    let debounce = 0
    const onDirty = () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        if (localStorage.getItem('dream-app-upload-declined') === '1') return
        if (localStorage.getItem('dream-app-upload-pending') === '1') return
        void pushAppCloud().catch(() => undefined)
      }, 2500)
    }
    window.addEventListener('dream-app-backup-dirty', onDirty)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(debounce)
      window.removeEventListener('dream-app-backup-dirty', onDirty)
    }
  }, [])
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
    let alive = true
    setApiKey(getToken())
    setCloudPhase('loading')
    const timeout = new Promise<never>((_, reject) => {
      const id = window.setTimeout(() => reject(new Error('同步超时，请检查网络后重试。')), 45_000)
      void id
    })
    void Promise.race([unlockAppCloud(), timeout])
      .then((state) => {
        if (!alive) return
        setCloudState(state)
        setCloudPhase('ready')
        if (!state.backup && state.localSessions > 0) {
          localStorage.setItem('dream-app-upload-pending', '1')
          setAskUpload(true)
        }
        void initChat()
      })
      .catch((error: unknown) => {
        if (!alive) return
        setCloudError(error instanceof Error ? error.message : '无法获取聊天记录密钥。')
        setCloudPhase('error')
      })
    const timer = window.setInterval(() => void maybePushAppCloud(), 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
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

  if (authed && cloudPhase === 'loading') {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingLogo}><BrandMark /></div>
        <div className={styles.loadingText}>正在解密聊天记录…</div>
      </div>
    )
  }

  if (authed && cloudPhase === 'error') {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingText}>{cloudError}</div>
        <Button variant="primary" onClick={() => window.location.reload()}>
          重试
        </Button>
        <Button
          onClick={() => {
            clearSession()
            setApiKey(null)
            setAuthed(false)
          }}
        >
          退出登录
        </Button>
      </div>
    )
  }

  if (!authed) {
    return (
      <LoginScreen
        onSuccess={() => setAuthed(true)}
      />
    )
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
      {askUpload ? (
        <Modal title="上传聊天记录到服务器" onClose={() => undefined}>
          <div className={styles.uploadPrompt}>
            <p>本机已有 {cloudState?.localSessions ?? 0} 个对话。上传后会压缩并用账号密钥加密，之后登录会与云端记录按时间合并。</p>
            <p>聊天记录会保存在服务器上；不上传则仅保留在本机。</p>
            <div className={styles.uploadActions}>
              <Button
                onClick={() => {
                  localStorage.setItem('dream-app-upload-declined', '1')
                  localStorage.removeItem('dream-app-upload-pending')
                  setAskUpload(false)
                }}
              >
                暂不上传
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  localStorage.removeItem('dream-app-upload-pending')
                  setAskUpload(false)
                  void pushAppCloud()
                }}
              >
                上传
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      <SettingsDialog />
      <Toast />
      {announcement ? (
        <Modal
          title={announcement.title || '公告'}
          onClose={() => {
            markAnnouncementSeen(announcement)
            setAnnouncement(null)
          }}
          footer={
            <Button
              variant="primary"
              size="m"
              onClick={() => {
                markAnnouncementSeen(announcement)
                setAnnouncement(null)
              }}
            >
              知道了
            </Button>
          }
        >
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{announcement.body}</div>
        </Modal>
      ) : null}
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
                  void installApk(downloadUrl, update.sha256)
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
