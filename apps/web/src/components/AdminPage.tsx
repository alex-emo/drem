import { useCallback, useEffect, useState } from "react";
import { getToken, clearSession } from "../lib/auth";

interface AdminStats {
  generatedAt: string;
  components: {
    api: string;
    serverVersion: string;
    uptimeSeconds: number;
    memoryMb: number;
    database: "ok" | "error";
    provider: string;
    providerLabel: string;
    model: string;
    keys: { total: number; available: number };
    lastRequestAt: string | null;
  };
  totals: {
    users: number;
    activeSessions: number;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    moderationEvents: number;
    moderationUsers: number;
    errorEvents: number;
  };
  users: Array<{
    id: string;
    username: string;
    createdAt: string;
    lastSeenAt: string | null;
    isAdmin: boolean;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    moderationCount: number;
    lastModerationAt: string | null;
  }>;
  keys: Array<{
    id: number;
    available: boolean;
    cooldownUntil: string | null;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    lastUsedAt: string | null;
  }>;
  days: Array<{
    day: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
  moderation: Array<{
    id: number;
    username: string;
    requestId: string;
    provider: string;
    model: string | null;
    stage: string;
    messageCount: number;
    detail: string | null;
    createdAt: string;
  }>;
  errors: Array<{
    id: number;
    requestId: string;
    method: string;
    path: string;
    status: number;
    code: string;
    message: string;
    username: string | null;
    createdAt: string;
  }>;
}

const number = (value: number) => value.toLocaleString("zh-CN");

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Dream 后台";
  }, []);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setError("请先返回聊天页登录管理员账号，再访问 /admin。");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/v1/admin/stats", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        clearSession();
        setError("登录已失效，请返回聊天页重新登录。");
        return;
      }
      if (response.status === 403) {
        setError("当前账号不是管理员，无法查看后台。");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStats((await response.json()) as AdminStats);
      setError(null);
    } catch (err) {
      setError(`加载失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (error) {
    return (
      <div className="admin-shell">
        <header className="admin-head">
          <div className="admin-brand">
            <span className="brand-logo">D</span>
            <span>Dream 后台</span>
          </div>
        </header>
        <main className="admin-main">
          <div className="admin-error">
            <p>{error}</p>
            <a className="admin-btn primary" href="/">
              返回聊天页
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div className="admin-shell">
        <main className="admin-main admin-muted">正在加载统计数据…</main>
      </div>
    );
  }

  const { components, totals } = stats;
  const online = components.keys.available > 0;

  return (
    <div className="admin-shell">
      <header className="admin-head">
        <div className="admin-brand">
          <span className="brand-logo">D</span>
          <span>Dream 后台</span>
        </div>
        <div className="admin-actions">
          <span className="admin-updated">更新于 {formatTime(stats.generatedAt)}</span>
          <button type="button" className="admin-btn" onClick={() => void load()}>
            刷新
          </button>
          <a className="admin-btn" href="/">
            返回聊天
          </a>
          <button
            type="button"
            className="admin-btn danger"
            onClick={() => {
              clearSession();
              window.location.href = "/";
            }}
          >
            退出
          </button>
        </div>
      </header>

      <main className="admin-main">
        <section className="admin-cards">
          <article className="admin-card">
            <span className="admin-card-label">用户</span>
            <strong>{number(totals.users)}</strong>
            <span className="admin-card-sub">近 24h 活跃会话 {number(totals.activeSessions)}</span>
          </article>
          <article className="admin-card">
            <span className="admin-card-label">请求</span>
            <strong>{number(totals.requests)}</strong>
            <span className="admin-card-sub">已记录 token 的请求</span>
          </article>
          <article className="admin-card">
            <span className="admin-card-label">总 tokens</span>
            <strong>{number(totals.totalTokens)}</strong>
            <span className="admin-card-sub">
              输入 {number(totals.promptTokens)} · 输出 {number(totals.completionTokens)}
            </span>
          </article>
          <article className={`admin-card ${online ? "ok" : "warn"}`}>
            <span className="admin-card-label">上游 Key</span>
            <strong>
              {components.keys.available}/{components.keys.total}
            </strong>
            <span className="admin-card-sub">{components.providerLabel} · {components.model}</span>
          </article>
          <article className={`admin-card ${totals.moderationEvents > 0 ? "warn" : ""}`}>
            <span className="admin-card-label">内容拦截</span>
            <strong>{number(totals.moderationEvents)}</strong>
            <span className="admin-card-sub">
              涉及 {number(totals.moderationUsers)} 个用户 · 错误 {number(totals.errorEvents)}
            </span>
          </article>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>组件状态</h2>
          </div>
          <div className="admin-components">
            <div><span>数据库</span><b className={components.database === "ok" ? "ok" : "bad"}>{components.database === "ok" ? "正常" : "异常"}</b></div>
            <div><span>上游</span><b className={online ? "ok" : "bad"}>{online ? "可用" : "不可用"}</b></div>
            <div><span>供应商 / 模型</span><b>{components.providerLabel} · {components.model}</b></div>
            <div><span>API 版本</span><b>{components.api} / {components.serverVersion}</b></div>
            <div><span>运行时长</span><b>{formatUptime(components.uptimeSeconds)}</b></div>
            <div><span>内存</span><b>{components.memoryMb} MB</b></div>
            <div><span>最近一次请求</span><b>{formatTime(components.lastRequestAt)}</b></div>
            <div><span>Key 状态</span><b>{components.keys.available}/{components.keys.total} 可用</b></div>
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>用户统计</h2>
            <span className="admin-muted">按注册时间排序</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>角色</th>
                  <th>注册时间</th>
                  <th>最近使用</th>
                  <th className="num">请求</th>
                  <th className="num">输入</th>
                  <th className="num">输出</th>
                  <th className="num">总 tokens</th>
                  <th className="num">拦截</th>
                  <th>最近拦截</th>
                </tr>
              </thead>
              <tbody>
                {stats.users.map((user) => (
                  <tr key={user.id}>
                    <td className="admin-user">{user.username}</td>
                    <td>{user.isAdmin ? <span className="admin-tag">管理员</span> : "用户"}</td>
                    <td>{formatTime(user.createdAt)}</td>
                    <td>{formatTime(user.lastSeenAt)}</td>
                    <td className="num">{number(user.requests)}</td>
                    <td className="num">{number(user.promptTokens)}</td>
                    <td className="num">{number(user.completionTokens)}</td>
                    <td className="num strong">{number(user.totalTokens)}</td>
                    <td className="num">
                      {user.moderationCount > 0 ? (
                        <span className="admin-tag bad" title={`最近：${formatTime(user.lastModerationAt)}`}>
                          {number(user.moderationCount)}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                    <td>{formatTime(user.lastModerationAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>Key 统计</h2>
            <span className="admin-muted">只显示序号与用量，不包含密钥</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>状态</th>
                  <th>请求</th>
                  <th className="num">输入</th>
                  <th className="num">输出</th>
                  <th className="num">总 tokens</th>
                  <th>最近使用</th>
                </tr>
              </thead>
              <tbody>
                {stats.keys.map((key) => (
                  <tr key={key.id}>
                    <td className="admin-user">#{key.id}</td>
                    <td>
                      {key.available ? (
                        <span className="admin-tag ok">可用</span>
                      ) : (
                        <span className="admin-tag bad" title={key.cooldownUntil ?? ""}>
                          冷却中
                        </span>
                      )}
                    </td>
                    <td>{number(key.requests)}</td>
                    <td className="num">{number(key.promptTokens)}</td>
                    <td className="num">{number(key.completionTokens)}</td>
                    <td className="num strong">{number(key.totalTokens)}</td>
                    <td>{formatTime(key.lastUsedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>内容拦截记录</h2>
            <span className="admin-muted">最近 50 条 · 不记录聊天正文</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>供应商</th>
                  <th>阶段</th>
                  <th className="num">消息数</th>
                  <th>上游说明</th>
                </tr>
              </thead>
              <tbody>
                {stats.moderation.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="admin-muted">
                      暂无内容拦截记录
                    </td>
                  </tr>
                ) : (
                  stats.moderation.map((event) => (
                    <tr key={event.id}>
                      <td>{formatTime(event.createdAt)}</td>
                      <td className="admin-user">{event.username}</td>
                      <td>{event.provider}</td>
                      <td>{event.stage === "fallback" ? "回退后拦截" : "主供应商拦截"}</td>
                      <td className="num">{number(event.messageCount)}</td>
                      <td className="admin-detail" title={event.detail ?? ""}>
                        {event.detail ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>最近错误</h2>
            <span className="admin-muted">最近 50 条 · 含上游错误与请求编号</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th className="num">状态</th>
                  <th>错误码</th>
                  <th>请求编号</th>
                  <th className="num">接口</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {stats.errors.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="admin-muted">
                      暂无错误记录
                    </td>
                  </tr>
                ) : (
                  stats.errors.map((event) => (
                    <tr key={event.id}>
                      <td>{formatTime(event.createdAt)}</td>
                      <td className="admin-user">{event.username ?? "—"}</td>
                      <td className="num">{event.status}</td>
                      <td><span className="admin-tag bad">{event.code}</span></td>
                      <td className="admin-request" title={event.requestId}>{event.requestId}</td>
                      <td className="num" title={event.path}>{event.method} {event.path}</td>
                      <td className="admin-detail" title={event.message}>
                        {event.message}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>近 7 天</h2>
            <span className="admin-muted">UTC 日期</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th className="num">请求</th>
                  <th className="num">输入</th>
                  <th className="num">输出</th>
                  <th className="num">总 tokens</th>
                </tr>
              </thead>
              <tbody>
                {stats.days.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="admin-muted">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  stats.days.map((day) => (
                    <tr key={day.day}>
                      <td>{day.day}</td>
                      <td className="num">{number(day.requests)}</td>
                      <td className="num">{number(day.promptTokens)}</td>
                      <td className="num">{number(day.completionTokens)}</td>
                      <td className="num strong">{number(day.totalTokens)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
