import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Button } from '../base/Button.js'
import { apiBase } from '../../services/dream/auth.js'
import { getToken } from '../../services/dream/auth.js'
import { showToast } from '../base/toastState.js'
import { APP_VERSION } from '../../services/dream/update.js'
import styles from './Settings.module.css'

type Platform = 'web' | 'app'
type Reproducible = 'always' | 'sometimes' | 'once' | 'unknown'

interface FeedbackReport {
  id: number
  description: string
  platform: Platform
  os: string
  osVersion: string
  appVersion: string
  reproducible: Reproducible
  adminReply: string | null
  repliedAt: string | null
  status: 'open' | 'replied' | 'closed'
  createdAt: string
}

const REPRODUCIBLE: Array<[Reproducible, string]> = [
  ['always', '每次都必现'],
  ['sometimes', '偶尔出现'],
  ['once', '只出现过一次'],
  ['unknown', '不确定'],
]

const detect = (): { platform: Platform; os: string; osVersion: string } => {
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor
  const platform: Platform = capacitor?.isNativePlatform?.() || (capacitor?.getPlatform && capacitor.getPlatform() !== 'web') ? 'app' : 'web'
  const ua = navigator.userAgent
  const android = ua.match(/Android\s([\d.]+)/i)
  const ios = ua.match(/iPhone OS\s([\d_]+)/i)
  if (android) return { platform, os: 'Android', osVersion: android[1] }
  if (ios) return { platform, os: 'iOS', osVersion: ios[1].replace(/_/g, '.') }
  return { platform, os: navigator.platform || '未知系统', osVersion: '' }
}

export const FeedbackPanel = () => {
  const [environment] = useState(detect)
  const [description, setDescription] = useState('')
  const [reproducible, setReproducible] = useState<Reproducible>('always')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [reports, setReports] = useState<FeedbackReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch(`${apiBase()}/feedback`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { reports?: FeedbackReport[] } | null) => {
        if (alive && payload?.reports) setReports(payload.reports)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!screenshot) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(screenshot)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [screenshot])

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (file && file.size > 5 * 1024 * 1024) {
      showToast('截图不能超过 5 MiB')
      return
    }
    setScreenshot(file)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (description.trim().length < 5) {
      showToast('请至少用 5 个字描述问题')
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.set('platform', environment.platform)
      form.set('os', environment.os)
      form.set('osVersion', environment.osVersion)
      form.set('appVersion', APP_VERSION)
      form.set('description', description.trim())
      form.set('reproducible', reproducible)
      if (screenshot) form.set('screenshot', screenshot, screenshot.name || 'screenshot.png')
      const response = await fetch(`${apiBase()}/feedback`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken() ?? ''}`, accept: 'application/json' },
        body: form,
      })
      const payload = (await response.json().catch(() => ({}))) as {
        report?: FeedbackReport
        error?: { message?: string }
      }
      if (!response.ok || !payload.report) {
        throw new Error(payload.error?.message ?? `提交失败（HTTP ${response.status}）`)
      }
      setReports((current) => [payload.report as FeedbackReport, ...current])
      setDescription('')
      setScreenshot(null)
      setReproducible('always')
      showToast('反馈已提交')
    } catch (error) {
      showToast((error as Error).message || '提交失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.feedback}>
      <p className={styles.feedbackHint}>
        遇到错误或想反馈问题，请尽量附上截图和复现方式。管理员回复会显示在下方。
      </p>
      <form className={styles.feedbackForm} onSubmit={submit}>
        <div className={styles.feedbackMeta}>
          <span>{environment.platform === 'app' ? 'App' : '网页端'}</span>
          <span>{environment.os}{environment.osVersion ? ` ${environment.osVersion}` : ''}</span>
          <span>v{APP_VERSION}</span>
        </div>
        <label className={styles.feedbackField}>
          <span>问题描述</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="例如：发送消息后一直显示生成中，点停止没有反应。"
          />
        </label>
        <label className={styles.feedbackField}>
          <span>是否稳定触发</span>
          <select value={reproducible} onChange={(event) => setReproducible(event.target.value as Reproducible)}>
            {REPRODUCIBLE.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className={styles.feedbackField}>
          <span>截图（可选，≤5 MiB）</span>
          <label className={styles.feedbackFile}>
            选择图片
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} />
          </label>
          {preview ? <img className={styles.feedbackPreview} src={preview} alt="截图预览" /> : null}
        </div>
        <Button type="submit" variant="primary" size="m" disabled={busy}>
          {busy ? '提交中…' : '提交反馈'}
        </Button>
      </form>

      <div className={styles.feedbackHistory}>
        <h4>我的反馈</h4>
        {loading ? <p className={styles.feedbackHint}>加载中…</p> : null}
        {!loading && reports.length === 0 ? <p className={styles.feedbackHint}>还没有提交过反馈。</p> : null}
        {reports.map((report) => (
          <article key={report.id} className={styles.feedbackItem}>
            <header>
              <span>{report.status === 'replied' ? '已回复' : report.status === 'closed' ? '已关闭' : '待处理'}</span>
              <time>{new Date(report.createdAt).toLocaleString()}</time>
            </header>
            <p>{report.description}</p>
            {report.adminReply ? (
              <div className={styles.feedbackReply}>
                <strong>管理员回复</strong>
                <p>{report.adminReply}</p>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}
