/** 后台日志：内存环形缓冲，保留最近 1000 条请求与错误。 */
export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  username?: string;
  message?: string;
}

const MAX_LOGS = 1000;
const entries: LogEntry[] = [];
let nextId = 1;

export function pushLog(input: Omit<LogEntry, "id" | "time">): void {
  entries.push({ id: nextId++, time: new Date().toISOString(), ...input });
  if (entries.length > MAX_LOGS) entries.splice(0, entries.length - MAX_LOGS);
}

export interface LogQuery {
  level?: string;
  search?: string;
  limit?: number;
  sort?: "time" | "status" | "duration" | "path";
  order?: "asc" | "desc";
}

export function listLogs(query: LogQuery): { items: LogEntry[]; total: number } {
  const level = (query.level ?? "").trim().toLowerCase();
  const search = (query.search ?? "").trim().toLowerCase();
  let items = entries.filter((entry) => {
    if (level && level !== "all" && entry.level !== level) return false;
    if (!search) return true;
    return [entry.username, entry.path, entry.method, entry.requestId, entry.message, String(entry.status)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
  const sort = query.sort ?? "time";
  const direction = query.order === "asc" ? 1 : -1;
  items = [...items].sort((a, b) => {
    const pick = (entry: LogEntry) =>
      sort === "status" ? entry.status : sort === "duration" ? entry.durationMs : sort === "path" ? entry.path : entry.time;
    const av = pick(a);
    const bv = pick(b);
    return av === bv ? b.id - a.id : av > bv ? direction : -direction;
  });
  const total = items.length;
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
  return { items: items.slice(0, limit), total };
}
