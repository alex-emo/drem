import { useState, type FormEvent } from 'react'
import { Button } from '../base/Button.js'
import { login, register, setSession, type DreamSession } from '../../services/dream/auth.js'
import { setApiKey } from '../../services/settings.js'
import styles from './LoginScreen.module.css'

type Props = {
  onSuccess: (session: DreamSession) => void
}

/** Dream 账号登录/注册。复用 chat-demo 的 Button 与主题变量。 */
export const LoginScreen = ({ onSuccess }: Props) => {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const name = username.trim()
    if (!name || !password) {
      setError('请输入用户名和密码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = mode === 'login' ? await login(name, password) : await register(name, password)
      setSession(session)
      setApiKey(session.token)
      onSuccess(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.brand}>
          <span className={styles.logo}>D</span>
          <span className={styles.name}>Dream</span>
        </div>
        <p className={styles.subtitle}>
          {mode === 'login' ? '登录后继续对话' : '注册一个 Dream 账号'}
        </p>
        <label className={styles.field}>
          <span>用户名</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="3-32 位字母、数字、下划线或中文"
            disabled={busy}
          />
        </label>
        <label className={styles.field}>
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="至少 8 位"
            disabled={busy}
          />
        </label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <Button type="submit" variant="primary" size="l" className={styles.submit} disabled={busy}>
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
        </Button>
        <button
          type="button"
          className={styles.switch}
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? '还没有账号？注册一个' : '已有账号？去登录'}
        </button>
        <p className={styles.note}>聊天记录只保存在当前设备，不会上传到服务器。</p>
      </form>
    </div>
  )
}
