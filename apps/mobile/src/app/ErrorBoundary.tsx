import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      const body = JSON.stringify({
        kind: 'render',
        message: error.message,
        stack: (error.stack || '').slice(0, 4000),
        componentStack: (info.componentStack || '').slice(0, 4000),
      })
      void fetch(`${__API_ORIGIN__}/api/v1/client-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined)
    } catch {
      // 诊断上报失败不影响错误页
    }
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 'calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))', background: '#000', color: '#f2f2f7', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: '#5686fe', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 24 }}>D</div>
        <strong style={{ fontSize: 17 }}>页面加载失败</strong>
        <p style={{ margin: 0, color: '#8e8e93', fontSize: 13, lineHeight: 1.7, maxWidth: 300 }}>
          请重新加载；如果反复失败，请更新系统 WebView 后再试。
        </p>
        <button type="button" onClick={() => location.reload()} style={{ padding: '9px 22px', border: 0, borderRadius: 20, background: '#5686fe', color: '#fff', fontSize: 14 }}>
          重新加载
        </button>
        <p style={{ margin: 0, color: '#636366', fontSize: 11, maxWidth: 300, wordBreak: 'break-all' }}>{this.state.error.message}</p>
      </div>
    )
  }
}
