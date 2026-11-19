import { db } from "./db.js";
import { keyPool } from "./keys.js";
import { config } from "./config.js";
import { API_VERSION, SERVER_VERSION } from "./protocol.js";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/** 把上游 usage 规范化为 camelCase；缺失时返回 null。 */
export function normalizeUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const promptTokens = asNumber(data.prompt_tokens);
  const completionTokens = asNumber(data.completion_tokens);
  const totalTokens = asNumber(data.total_tokens) || promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return null;
  return { promptTokens, completionTokens, totalTokens };
}

export interface RecordUsageInput {
  userId: string;
  username: string;
  keyId: number;
  model: string;
  kind: "chat" | "summary";
  usage: TokenUsage | null;
}

/** 记录一次请求的 token 消耗（没有 usage 时按 0 记，保留请求次数）。 */
export function recordUsage(input: RecordUsageInput): void {
  const usage = input.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  try {
    db.prepare(
      `INSERT INTO usage_events
        (user_id, username, key_id, model, kind, prompt_tokens, completion_tokens, total_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.userId,
      input.username,
      input.keyId,
      input.model,
      input.kind,
      usage.promptTokens,
      usage.completionTokens,
      usage.totalTokens,
      new Date().toISOString(),
    );
  } catch (error) {
    // 统计失败不应影响对话本身。
    console.warn(`[dream-server] failed to record usage: ${(error as Error).message}`);
  }
}

interface TotalsRow {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface UserStatRow {
  id: string;
  username: string;
  created_at: string;
  last_seen_at: string | null;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface KeyStatRow {
  key_id: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  last_used_at: string | null;
}

interface DayStatRow {
  day: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AdminStats {
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
}

function queryTotals(): TotalsRow {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM usage_events`,
    )
    .get() as unknown as TotalsRow;
  return row;
}

export function getAdminStats(isAdmin: (username: string) => boolean): AdminStats {
  let database: "ok" | "error" = "ok";
  try {
    db.prepare("SELECT 1").get();
  } catch {
    database = "error";
  }

  const users = (
    db
      .prepare(
        `SELECT u.id, u.username, u.created_at,
                (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
                COUNT(e.id) AS requests,
                COALESCE(SUM(e.prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(e.completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(e.total_tokens), 0) AS total_tokens
         FROM users u
         LEFT JOIN usage_events e ON e.user_id = u.id
         GROUP BY u.id
         ORDER BY u.created_at ASC`,
      )
      .all() as unknown as UserStatRow[]
  ).map((row) => ({
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    isAdmin: isAdmin(row.username),
    requests: row.requests,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
  }));

  const keyRows = db
    .prepare(
      `SELECT key_id, COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              MAX(created_at) AS last_used_at
       FROM usage_events GROUP BY key_id`,
    )
    .all() as unknown as KeyStatRow[];
  const keyById = new Map(keyRows.map((row) => [row.key_id, row]));
  const keys = keyPool.details().map((detail) => {
    const row = keyById.get(detail.id);
    return {
      id: detail.id,
      available: detail.available,
      cooldownUntil: detail.cooldownUntil ? new Date(detail.cooldownUntil).toISOString() : null,
      requests: row?.requests ?? 0,
      promptTokens: row?.prompt_tokens ?? 0,
      completionTokens: row?.completion_tokens ?? 0,
      totalTokens: row?.total_tokens ?? 0,
      lastUsedAt: row?.last_used_at ?? null,
    };
  });

  const days = (
    db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS requests,
                COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(total_tokens), 0) AS total_tokens
         FROM usage_events
         WHERE created_at >= datetime('now', '-7 days')
         GROUP BY day ORDER BY day ASC`,
      )
      .all() as unknown as DayStatRow[]
  ).map((row) => ({
    day: row.day,
    requests: row.requests,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
  }));

  const totals = queryTotals();
  const sessions = db
    .prepare("SELECT COUNT(*) AS active FROM sessions WHERE last_seen_at >= datetime('now', '-1 day')")
    .get() as unknown as { active: number };
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get() as unknown as {
    count: number;
  };
  const last = db.prepare("SELECT MAX(created_at) AS at FROM usage_events").get() as unknown as {
    at: string | null;
  };

  return {
    generatedAt: new Date().toISOString(),
    components: {
      api: API_VERSION,
      serverVersion: SERVER_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      database,
      provider: config.provider,
      providerLabel: config.providerLabel,
      model: config.model,
      keys: keyPool.stats(),
      lastRequestAt: last.at,
    },
    totals: {
      users: userCount.count,
      activeSessions: sessions.active,
      requests: totals.requests,
      promptTokens: totals.prompt_tokens,
      completionTokens: totals.completion_tokens,
      totalTokens: totals.total_tokens,
    },
    users,
    keys,
    days,
  };
}
