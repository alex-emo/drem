import { useCallback, useEffect, useMemo, useState } from "react";
import { getToken, clearSession } from "../lib/auth";
import { formatBytes } from "../lib/storage";

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
    displayName: string | null;
    disabled: boolean;
    verified: boolean;
    createdAt: string;
    lastSeenAt: string | null;
    isAdmin: boolean;
    sessions: number;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    moderationCount: number;
    lastModerationAt: string | null;
    memoryBytes: number;
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
  days: Array<{ day: string; requests: number; promptTokens: number; completionTokens: number; totalTokens: number }>;
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

interface LogEntry {
  id: number;
  time: string;
  level: "info" | "warn" | "error";
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  username?: string;
  message?: string;
}

type Page = "overview" | "users" | "keys" | "moderation" | "errors" | "logs";
type SortDirection = "asc" | "desc";

const PAGE_TITLES: Record<Page, string> = {
  overview: "概述",
  users: "用户",
  keys: "上游 Key",
  moderation: "内容拦截",
  errors: "错误记录",
  logs: "请求日志",
};

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

function sortRows<T>(rows: T[], pick: (row: T) => string | number | null, direction: SortDirection): T[] {
  return [...rows].sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (av === bv) return 0;
    if (av === null || av === "") return 1;
    if (bv === null || bv === "") return -1;
    return (av > bv ? 1 : -1) * (direction === "asc" ? 1 : -1);
  });
}

function matches(search: string, ...values: Array<string | number | null | undefined>): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => value !== null && value !== undefined && String(value).toLowerCase().includes(query));
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const content = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SortButton({
  label,
  column,
  sort,
  direction,
  onSort,
  className,
}: {
  label: string;
  column: string;
  sort: string;
  direction: SortDirection;
  onSort: (column: string) => void;
  className?: string;
}) {
  const active = sort === column;
  return (
    <button type="button" className={`admin-sort ${className ?? ""}`} onClick={() => onSort(column)}>
      {label}
      <span aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}

function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  return (
    <div className="admin-pager">
      <span>
        共 {total} 条 · 第 {current}/{pages} 页
      </span>
      <div>
        <button type="button" className="admin-btn" disabled={current <= 1} onClick={() => onPage(current - 1)}>
          上一页
        </button>
        <button type="button" className="admin-btn" disabled={current >= pages} onClick={() => onPage(current + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [sort, setSort] = useState("time");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = getToken();
  const currentUserId = useMemo(() => {
    try {
      return (JSON.parse(localStorage.getItem("dream-user") ?? "{}") as { id?: string }).id ?? null;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    if (!token) {
      setError("请先返回聊天页登录管理员账号，再访问 /admin。");
      setLoading(false);
      return;
    }
    try {
      const [statsResponse, logsResponse] = await Promise.all([
        fetch("/api/v1/admin/stats", { headers: { authorization: `Bearer ${token}` } }),
        fetch("/api/v1/admin/logs?limit=500", { headers: { authorization: `Bearer ${token}` } }),
      ]);
      if (statsResponse.status === 401 || logsResponse.status === 401) {
        clearSession();
        setError("登录已失效，请返回聊天页重新登录。");
        return;
      }
      if (statsResponse.status === 403) {
        setError("当前账号不是管理员，无法查看后台。");
        return;
      }
      if (!statsResponse.ok) throw new Error(`HTTP ${statsResponse.status}`);
      setStats((await statsResponse.json()) as AdminStats);
      if (logsResponse.ok) {
        const payload = (await logsResponse.json()) as { items: LogEntry[] };
        setLogs(payload.items);
      }
      setError(null);
    } catch (err) {
      setError(`加载失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    document.title = "Dream 后台";
  }, []);

  useEffect(() => {
    void load();
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load, autoRefresh]);

  useEffect(() => {
    setCurrentPage(1);
  }, [page, search, level, sort, direction, pageSize]);

  const act = useCallback(
    async (path: string, method: string, body?: unknown, message?: string) => {
      if (!token) return;
      setBusy(path);
      try {
        const response = await fetch(path, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
        setNotice(message ?? "操作成功");
        await load();
      } catch (err) {
        setNotice(`操作失败：${(err as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [load, token],
  );

  const onSort = (column: string) => {
    if (sort === column) {
      setDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSort(column);
      setDirection("desc");
    }
  };

  const users = useMemo(() => {
    if (!stats) return [];
    const filtered = stats.users.filter((user) => matches(search, user.username, user.displayName, user.id));
    return sortRows(
      filtered,
      (user) =>
        sort === "username"
          ? user.username
          : sort === "created"
            ? user.createdAt
            : sort === "lastSeen"
              ? user.lastSeenAt
              : sort === "requests"
                ? user.requests
                : sort === "sessions"
                  ? user.sessions
                  : sort === "memory"
                    ? user.memoryBytes
                    : sort === "moderation"
                  ? user.moderationCount
                  : user.totalTokens,
      direction,
    );
  }, [stats, search, sort, direction]);

  const keys = useMemo(() => {
    if (!stats) return [];
    return sortRows(
      stats.keys.filter((key) => matches(search, key.id, key.requests, key.totalTokens)),
      (key) => (sort === "id" ? key.id : sort === "lastUsed" ? key.lastUsedAt : sort === "requests" ? key.requests : key.totalTokens),
      direction,
    );
  }, [stats, search, sort, direction]);

  const moderation = useMemo(() => {
    if (!stats) return [];
    return sortRows(
      stats.moderation.filter((event) => matches(search, event.username, event.requestId, event.detail, event.stage)),
      (event) =>
        sort === "user" ? event.username : sort === "messages" ? event.messageCount : event.createdAt,
      direction,
    );
  }, [stats, search, sort, direction]);

  const errors = useMemo(() => {
    if (!stats) return [];
    return sortRows(
      stats.errors.filter((event) => matches(search, event.username, event.code, event.path, event.message, event.requestId)),
      (event) => (sort === "status" ? event.status : sort === "code" ? event.code : event.createdAt),
      direction,
    );
  }, [stats, search, sort, direction]);

  const filteredLogs = useMemo(() => {
    const rows = logs.filter((entry) => {
      if (level !== "all" && entry.level !== level) return false;
      return matches(search, entry.username, entry.path, entry.method, entry.requestId, entry.message, entry.status);
    });
    return sortRows(
      rows,
      (entry) =>
        sort === "status" ? entry.status : sort === "duration" ? entry.durationMs : sort === "path" ? entry.path : entry.time,
      direction,
    );
  }, [logs, level, search, sort, direction]);

  const pageRows = <T,>(rows: T[]): T[] => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const resetSort = (nextPage: Page) => {
    setPage(nextPage);
    setDrawerOpen(false);
    setSearch("");
    setLevel("all");
    setSort(nextPage === "users" ? "tokens" : nextPage === "keys" ? "tokens" : "time");
    setDirection("desc");
  };

  if (error) {
    return (
      <div className="admin-shell">
        <header className="admin-head">
          <div className="admin-brand"><span className="brand-logo">D</span><span>Dream 后台</span></div>
        </header>
        <main className="admin-main">
          <div className="admin-error">
            <p>{error}</p>
            <a className="admin-btn primary" href="/">返回聊天页</a>
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
  const maxTokens = Math.max(1, ...stats.days.map((day) => day.totalTokens));

  const exportUsers = () =>
    downloadCsv(
      "dream-users.csv",
      ["用户", "显示名称", "角色", "状态", "验证", "会话", "记忆", "注册时间", "最近使用", "请求", "输入", "输出", "总tokens", "拦截"],
      users.map((user) => [
        user.username,
        user.displayName ?? "",
        user.isAdmin ? "管理员" : "用户",
        user.disabled ? "已禁用" : "正常",
        user.verified ? "已验证" : "未验证",
        user.sessions,
        formatBytes(user.memoryBytes),
        formatTime(user.createdAt),
        formatTime(user.lastSeenAt),
        user.requests,
        user.promptTokens,
        user.completionTokens,
        user.totalTokens,
        user.moderationCount,
      ]),
    );

  const exportLogs = () =>
    downloadCsv(
      "dream-logs.csv",
      ["时间", "级别", "用户", "方法", "路径", "状态", "耗时ms", "请求编号", "信息"],
      filteredLogs.map((entry) => [
        formatTime(entry.time),
        entry.level,
        entry.username ?? "",
        entry.method,
        entry.path,
        entry.status,
        entry.durationMs,
        entry.requestId,
        entry.message ?? "",
      ]),
    );

  const renderTable = () => {
    if (page === "users") {
      return (
        <>
          <div className="admin-toolbar">
            <input className="admin-input" placeholder="搜索用户名 / ID" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className="admin-select" value={`${sort}:${direction}`} onChange={(event) => {
              const [nextSort, nextDirection] = event.target.value.split(":");
              setSort(nextSort);
              setDirection(nextDirection as SortDirection);
            }}>
              <option value="tokens:desc">总 tokens ↓</option>
              <option value="requests:desc">请求数 ↓</option>
              <option value="created:desc">注册时间 ↓</option>
              <option value="lastSeen:desc">最近使用 ↓</option>
              <option value="moderation:desc">拦截次数 ↓</option>
              <option value="username:asc">用户名 A-Z</option>
            </select>
            <button type="button" className="admin-btn" onClick={exportUsers}>导出 CSV</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th><SortButton label="用户" column="username" sort={sort} direction={direction} onSort={onSort} /></th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>验证</th>
                  <th className="num"><SortButton label="会话" column="sessions" sort={sort} direction={direction} onSort={onSort} /></th>
                  <th className="num"><SortButton label="记忆" column="memory" sort={sort} direction={direction} onSort={onSort} /></th>
                  <th><SortButton label="注册时间" column="created" sort={sort} direction={direction} onSort={onSort} /></th>
                  <th><SortButton label="最近使用" column="lastSeen" sort={sort} direction={direction} onSort={onSort} /></th>
                  <th className="num"><SortButton label="请求" column="requests" sort={sort} direction={direction} onSort={onSort} /></th>
                  <th className="num"><SortButton label="总 tokens" column="tokens" sort={sort} direction={direction} onSort={onSort} /></th>
                  <th className="num"><SortButton label="拦截" column="moderation" sort={sort} direction={direction} onSort={onSort} /></th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows(users).map((user) => {
                  const isSelf = currentUserId !== null && user.id === currentUserId;
                  return (
                  <tr key={user.id} className={user.disabled ? "admin-row-disabled" : ""}>
                    <td>
                      <div className="admin-user">{user.username}</div>
                      {user.displayName ? <div className="admin-sub">{user.displayName}</div> : null}
                    </td>
                    <td>{user.isAdmin ? <span className="admin-tag">管理员</span> : "用户"}</td>
                    <td>{user.disabled ? <span className="admin-tag bad">已禁用</span> : <span className="admin-tag ok">正常</span>}</td>
                    <td>{user.verified ? <span className="admin-tag ok">已验证</span> : <span className="admin-tag bad">未验证</span>}</td>
                    <td className="num">{user.sessions}</td>
                    <td className="num">{formatBytes(user.memoryBytes)}</td>
                    <td>{formatTime(user.createdAt)}</td>
                    <td>{formatTime(user.lastSeenAt)}</td>
                    <td className="num">{number(user.requests)}</td>
                    <td className="num strong">{number(user.totalTokens)}</td>
                    <td className="num">{user.moderationCount ? <span className="admin-tag bad">{user.moderationCount}</span> : 0}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-btn tiny"
                          disabled={busy !== null}
                          onClick={() => void act(`/api/v1/admin/users/${user.id}`, "PATCH", { verified: !user.verified }, user.verified ? `已取消 ${user.username} 的验证` : `已验证 ${user.username}`)}
                        >
                          {user.verified ? "取消验证" : "标记验证"}
                        </button>
                        <button
                          type="button"
                          className="admin-btn tiny"
                          disabled={busy !== null || isSelf}
                          title={isSelf ? "不能禁用当前登录账号" : undefined}
                          onClick={() => void act(`/api/v1/admin/users/${user.id}`, "PATCH", { disabled: !user.disabled }, user.disabled ? `已启用 ${user.username}` : `已禁用 ${user.username}`)}
                        >
                          {user.disabled ? "启用" : "禁用"}
                        </button>
                        <button
                          type="button"
                          className="admin-btn tiny"
                          disabled={busy !== null}
                          onClick={() => {
                            const password = window.prompt(`为 ${user.username} 设置新密码（至少 8 位）`);
                            if (password) void act(`/api/v1/admin/users/${user.id}/password`, "POST", { password }, "密码已重置");
                          }}
                        >
                          重置密码
                        </button>
                        <button
                          type="button"
                          className="admin-btn tiny"
                          disabled={busy !== null}
                          onClick={() => void act(`/api/v1/admin/users/${user.id}/revoke`, "POST", undefined, "已撤销该用户全部会话")}
                        >
                          下线
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={currentPage} pageSize={pageSize} total={users.length} onPage={setCurrentPage} />
        </>
      );
    }

    if (page === "keys") {
      return (
        <>
          <div className="admin-toolbar">
            <input className="admin-input" placeholder="搜索 Key 序号" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className="admin-select" value={sort} onChange={(event) => { setSort(event.target.value); setDirection("desc"); }}>
              <option value="tokens">按 tokens</option>
              <option value="requests">按请求数</option>
              <option value="lastUsed">按最近使用</option>
              <option value="id">按序号</option>
            </select>
            <button type="button" className="admin-btn" onClick={() => downloadCsv("dream-keys.csv", ["Key", "状态", "请求", "输入", "输出", "总tokens", "最近使用"], keys.map((key) => [key.id, key.available ? "可用" : "冷却", key.requests, key.promptTokens, key.completionTokens, key.totalTokens, formatTime(key.lastUsedAt)]))}>导出 CSV</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Key</th><th>状态</th><th className="num">请求</th><th className="num">输入</th><th className="num">输出</th><th className="num">总 tokens</th><th>最近使用</th></tr></thead>
              <tbody>
                {pageRows(keys).map((key) => (
                  <tr key={key.id}>
                    <td className="admin-user">#{key.id}</td>
                    <td>{key.available ? <span className="admin-tag ok">可用</span> : <span className="admin-tag bad" title={key.cooldownUntil ?? ""}>冷却中</span>}</td>
                    <td className="num">{number(key.requests)}</td>
                    <td className="num">{number(key.promptTokens)}</td>
                    <td className="num">{number(key.completionTokens)}</td>
                    <td className="num strong">{number(key.totalTokens)}</td>
                    <td>{formatTime(key.lastUsedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={currentPage} pageSize={pageSize} total={keys.length} onPage={setCurrentPage} />
        </>
      );
    }

    if (page === "moderation") {
      return (
        <>
          <div className="admin-toolbar">
            <input className="admin-input" placeholder="搜索用户 / 说明 / 请求编号" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button type="button" className="admin-btn" onClick={() => downloadCsv("dream-moderation.csv", ["时间", "用户", "供应商", "阶段", "消息数", "请求编号", "说明"], moderation.map((event) => [formatTime(event.createdAt), event.username, event.provider, event.stage, event.messageCount, event.requestId, event.detail ?? ""]))}>导出 CSV</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>时间</th><th><SortButton label="用户" column="user" sort={sort} direction={direction} onSort={onSort} /></th><th>供应商</th><th>阶段</th><th className="num"><SortButton label="消息数" column="messages" sort={sort} direction={direction} onSort={onSort} /></th><th>请求编号</th><th>上游说明</th></tr></thead>
              <tbody>
                {moderation.length === 0 ? <tr><td colSpan={7} className="admin-muted">暂无内容拦截记录</td></tr> : pageRows(moderation).map((event) => (
                  <tr key={event.id}>
                    <td>{formatTime(event.createdAt)}</td>
                    <td className="admin-user">{event.username}</td>
                    <td>{event.provider}</td>
                    <td>{event.stage === "fallback" ? "回退后拦截" : "主供应商拦截"}</td>
                    <td className="num">{number(event.messageCount)}</td>
                    <td className="admin-request" title={event.requestId}>{event.requestId}</td>
                    <td className="admin-detail" title={event.detail ?? ""}>{event.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={currentPage} pageSize={pageSize} total={moderation.length} onPage={setCurrentPage} />
        </>
      );
    }

    if (page === "errors") {
      return (
        <>
          <div className="admin-toolbar">
            <input className="admin-input" placeholder="搜索错误码 / 用户 / 请求编号 / 说明" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button type="button" className="admin-btn" onClick={() => downloadCsv("dream-errors.csv", ["时间", "用户", "状态", "错误码", "请求编号", "接口", "说明"], errors.map((event) => [formatTime(event.createdAt), event.username ?? "", event.status, event.code, event.requestId, `${event.method} ${event.path}`, event.message]))}>导出 CSV</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>时间</th><th>用户</th><th className="num"><SortButton label="状态" column="status" sort={sort} direction={direction} onSort={onSort} /></th><th><SortButton label="错误码" column="code" sort={sort} direction={direction} onSort={onSort} /></th><th>请求编号</th><th>接口</th><th>说明</th></tr></thead>
              <tbody>
                {errors.length === 0 ? <tr><td colSpan={7} className="admin-muted">暂无错误记录</td></tr> : pageRows(errors).map((event) => (
                  <tr key={event.id}>
                    <td>{formatTime(event.createdAt)}</td>
                    <td className="admin-user">{event.username ?? "—"}</td>
                    <td className="num">{event.status}</td>
                    <td><span className="admin-tag bad">{event.code}</span></td>
                    <td className="admin-request" title={event.requestId}>{event.requestId}</td>
                    <td className="num" title={event.path}>{event.method} {event.path}</td>
                    <td className="admin-detail" title={event.message}>{event.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={currentPage} pageSize={pageSize} total={errors.length} onPage={setCurrentPage} />
        </>
      );
    }

    if (page === "logs") {
      return (
        <>
          <div className="admin-toolbar">
            <input className="admin-input" placeholder="搜索路径 / 用户 / 请求编号 / 状态" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className="admin-select" value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="all">全部级别</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
            <select className="admin-select" value={`${sort}:${direction}`} onChange={(event) => {
              const [nextSort, nextDirection] = event.target.value.split(":");
              setSort(nextSort);
              setDirection(nextDirection as SortDirection);
            }}>
              <option value="time:desc">时间 ↓</option>
              <option value="time:asc">时间 ↑</option>
              <option value="status:desc">状态 ↓</option>
              <option value="duration:desc">耗时 ↓</option>
            </select>
            <button type="button" className="admin-btn" onClick={exportLogs}>导出 CSV</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>时间</th><th>级别</th><th>用户</th><th>请求</th><th className="num"><SortButton label="状态" column="status" sort={sort} direction={direction} onSort={onSort} /></th><th className="num"><SortButton label="耗时" column="duration" sort={sort} direction={direction} onSort={onSort} /></th><th>请求编号</th><th>信息</th></tr></thead>
              <tbody>
                {filteredLogs.length === 0 ? <tr><td colSpan={8} className="admin-muted">暂无日志</td></tr> : pageRows(filteredLogs).map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatTime(entry.time)}</td>
                    <td><span className={`admin-tag ${entry.level === "error" ? "bad" : entry.level === "warn" ? "warn" : "ok"}`}>{entry.level}</span></td>
                    <td className="admin-user">{entry.username ?? "—"}</td>
                    <td className="admin-request" title={entry.path}>{entry.method} {entry.path}</td>
                    <td className="num">{entry.status}</td>
                    <td className="num">{entry.durationMs} ms</td>
                    <td className="admin-request" title={entry.requestId}>{entry.requestId}</td>
                    <td className="admin-detail" title={entry.message ?? ""}>{entry.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={currentPage} pageSize={pageSize} total={filteredLogs.length} onPage={setCurrentPage} />
        </>
      );
    }

    return null;
  };

  return (
    <div className="admin-shell">
      <header className="admin-head">
        <div className="admin-head-left">
          <button type="button" className="admin-drawer-toggle" onClick={() => setDrawerOpen((value) => !value)} aria-label="切换后台导航">☰</button>
          <div className="admin-brand"><span className="brand-logo">D</span><span>Dream 后台</span></div>
          <span className="admin-head-page">{PAGE_TITLES[page]}</span>
        </div>
        <div className="admin-actions">
          <span className="admin-updated">更新于 {formatTime(stats.generatedAt)}</span>
          <label className="admin-auto">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            自动刷新
          </label>
          <button type="button" className="admin-btn" onClick={() => void load()} disabled={busy !== null}>刷新</button>
          <a className="admin-btn" href="/">返回聊天</a>
          <button type="button" className="admin-btn danger" onClick={() => { clearSession(); window.location.href = "/"; }}>退出</button>
        </div>
      </header>

      {notice ? (
        <div className="admin-toast" role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>×</button>
        </div>
      ) : null}

      <div className="admin-layout">
        <aside className={`admin-sidebar ${drawerOpen ? "open" : ""}`}>
          <nav className="admin-nav">
            {(["overview", "users", "keys", "moderation", "errors", "logs"] as Page[]).map((item) => (
              <button key={item} type="button" className={`admin-nav-item ${page === item ? "active" : ""}`} onClick={() => resetSort(item)}>
                <span>{PAGE_TITLES[item]}</span>
                {item === "users" ? <em>{totals.users}</em> : null}
                {item === "moderation" ? <em>{totals.moderationEvents}</em> : null}
                {item === "errors" ? <em>{totals.errorEvents}</em> : null}
              </button>
            ))}
          </nav>
          <div className="admin-sidebar-foot">
            <span>版本 {components.serverVersion}</span>
            <span>{components.providerLabel} · {components.model}</span>
          </div>
        </aside>
        {drawerOpen ? <div className="admin-overlay" onClick={() => setDrawerOpen(false)} /> : null}

        <main className="admin-main">
          {page === "overview" ? (
            <>
              <section className="admin-cards">
                <article className="admin-card"><span className="admin-card-label">用户</span><strong>{number(totals.users)}</strong><span className="admin-card-sub">近 24h 活跃会话 {number(totals.activeSessions)}</span></article>
                <article className="admin-card"><span className="admin-card-label">请求</span><strong>{number(totals.requests)}</strong><span className="admin-card-sub">已记录 token 的请求</span></article>
                <article className="admin-card"><span className="admin-card-label">总 tokens</span><strong>{number(totals.totalTokens)}</strong><span className="admin-card-sub">输入 {number(totals.promptTokens)} · 输出 {number(totals.completionTokens)}</span></article>
                <article className={`admin-card ${online ? "ok" : "warn"}`}><span className="admin-card-label">上游 Key</span><strong>{components.keys.available}/{components.keys.total}</strong><span className="admin-card-sub">{components.providerLabel} · {components.model}</span></article>
                <article className={`admin-card ${totals.moderationEvents > 0 ? "warn" : ""}`}><span className="admin-card-label">内容拦截</span><strong>{number(totals.moderationEvents)}</strong><span className="admin-card-sub">涉及 {number(totals.moderationUsers)} 个用户</span></article>
                <article className={`admin-card ${totals.errorEvents > 0 ? "bad" : ""}`}><span className="admin-card-label">错误</span><strong>{number(totals.errorEvents)}</strong><span className="admin-card-sub">可在错误记录中查看</span></article>
              </section>

              <section className="admin-grid-2">
                <div className="admin-panel">
                  <div className="admin-panel-head"><h2>组件状态</h2></div>
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
                </div>

                <div className="admin-panel">
                  <div className="admin-panel-head"><h2>近 7 天 tokens</h2><span className="admin-muted">UTC</span></div>
                  <div className="admin-chart">
                    {stats.days.length === 0 ? <span className="admin-muted">暂无数据</span> : stats.days.map((day) => (
                      <div className="admin-chart-col" key={day.day} title={`${day.day} · ${number(day.totalTokens)} tokens`}>
                        <div className="admin-chart-bar" style={{ height: `${Math.max(4, (day.totalTokens / maxTokens) * 100)}%` }} />
                        <span>{day.day.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="admin-mini-table">
                    {stats.days.slice(-3).reverse().map((day) => (
                      <div key={day.day}><span>{day.day}</span><b>{number(day.requests)} 请求 · {number(day.totalTokens)} tokens</b></div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="admin-panel">
                <div className="admin-panel-head"><h2>最近动态</h2><button type="button" className="admin-btn tiny" onClick={() => resetSort("logs")}>查看全部日志</button></div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th>时间</th><th>级别</th><th>用户</th><th>请求</th><th>状态</th><th>耗时</th></tr></thead>
                    <tbody>
                      {logs.slice(0, 8).map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatTime(entry.time)}</td>
                          <td><span className={`admin-tag ${entry.level === "error" ? "bad" : entry.level === "warn" ? "warn" : "ok"}`}>{entry.level}</span></td>
                          <td>{entry.username ?? "—"}</td>
                          <td className="admin-request">{entry.method} {entry.path}</td>
                          <td className="num">{entry.status}</td>
                          <td className="num">{entry.durationMs} ms</td>
                        </tr>
                      ))}
                      {logs.length === 0 ? <tr><td colSpan={6} className="admin-muted">暂无请求日志</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <section className="admin-panel admin-page-panel">
              <div className="admin-panel-head">
                <div>
                  <h2>{PAGE_TITLES[page]}</h2>
                  <span className="admin-muted">{page === "users" ? "管理账号状态、密码与会话" : page === "logs" ? "最近 1000 条请求与错误" : "支持搜索、排序、分页与导出"}</span>
                </div>
                <select className="admin-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  <option value={10}>10 条/页</option>
                  <option value={20}>20 条/页</option>
                  <option value={50}>50 条/页</option>
                  <option value={100}>100 条/页</option>
                </select>
              </div>
              {renderTable()}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
