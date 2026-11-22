import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** 避免运行时异常导致整页纯黑，给用户一个可恢复的提示。 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Dream UI crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth-screen">
        <div className="crash-card">
          <h1>页面加载出错</h1>
          <p className="auth-muted">本地聊天记录不会被删除，可以刷新后重试。</p>
          <pre>{this.state.error.message}</pre>
          <div className="crash-actions">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
