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
  const promptTokens = asNumber(data.prompt_tokens) || asNumber(data.input_tokens);
  const completionTokens = asNumber(data.completion_tokens) || asNumber(data.output_tokens);
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

export interface RecordModerationInput {
  userId: string;
  username: string;
  requestId: string;
  provider: string;
  model: string;
  stage: "primary" | "fallback";
  messageCount: number;
  detail: string;
}

/** 记录一次触发的上游内容安全拦截（每个阶段一条，便于排查）。 */
export function recordModeration(input: RecordModerationInput): void {
  try {
    db.prepare(
      `INSERT INTO moderation_events
        (user_id, username, request_id, provider, model, stage, message_count, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.userId,
      input.username,
      input.requestId,
      input.provider,
      input.model,
      input.stage,
      input.messageCount,
      input.detail.slice(0, 1000),
      new Date().toISOString(),
    );
  } catch (error) {
    console.warn(`[dream-server] failed to record moderation event: ${(error as Error).message}`);
  }
}

export interface RecordErrorInput {
  requestId: string;
  method: string;
  path: string;
  status: number;
  code: string;
  message: string;
  username?: string | null;
}

/** 记录服务端/上游错误，供后台查看，定位线上问题。 */
export function recordError(input: RecordErrorInput): void {
  try {
    db.prepare(
      `INSERT INTO error_events
        (request_id, method, path, status, code, message, username, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.requestId,
      input.method,
      input.path,
      input.status,
      input.code,
      input.message.slice(0, 2000),
      input.username ?? null,
      new Date().toISOString(),
    );
  } catch (error) {
    console.warn(`[dream-server] failed to record error event: ${(error as Error).message}`);
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
  display_name: string | null;
  disabled: number;
  verified: number;
  created_at: string;
  last_seen_at: string | null;
  sessions: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  moderation_count: number;
  last_moderation_at: string | null;
  backup_size: number;
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
        `SELECT u.id, u.username, u.display_name, u.disabled, u.verified, u.created_at,
                (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
                (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
                COUNT(e.id) AS requests,
                COALESCE(SUM(e.prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(e.completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(e.total_tokens), 0) AS total_tokens,
                (SELECT COUNT(DISTINCT request_id) FROM moderation_events m WHERE m.user_id = u.id) AS moderation_count,
                (SELECT MAX(created_at) FROM moderation_events m WHERE m.user_id = u.id) AS last_moderation_at,
                COALESCE((SELECT size FROM chat_backups b WHERE b.user_id = u.id), 0) AS backup_size
         FROM users u
         LEFT JOIN usage_events e ON e.user_id = u.id
         GROUP BY u.id
         ORDER BY u.created_at ASC`,
      )
      .all() as unknown as UserStatRow[]
  ).map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    disabled: Boolean(row.disabled),
    verified: Boolean(row.verified),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    isAdmin: isAdmin(row.username),
    sessions: row.sessions,
    requests: row.requests,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    moderationCount: row.moderation_count,
    lastModerationAt: row.last_moderation_at,
    memoryBytes: row.backup_size ?? 0,
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

  const moderationRows = db
    .prepare(
      `SELECT id, username, request_id, provider, model, stage, message_count, detail, created_at
       FROM moderation_events ORDER BY id DESC LIMIT 50`,
    )
    .all() as unknown as Array<{
    id: number;
    username: string;
    request_id: string;
    provider: string;
    model: string | null;
    stage: string;
    message_count: number;
    detail: string | null;
    created_at: string;
  }>;
  const moderation = moderationRows.map((row) => ({
    id: row.id,
    username: row.username,
    requestId: row.request_id,
    provider: row.provider,
    model: row.model,
    stage: row.stage,
    messageCount: row.message_count,
    detail: row.detail,
    createdAt: row.created_at,
  }));

  const errorRows = db
    .prepare(
      `SELECT id, request_id, method, path, status, code, message, username, created_at
       FROM error_events ORDER BY id DESC LIMIT 50`,
    )
    .all() as unknown as Array<{
    id: number;
    request_id: string;
    method: string;
    path: string;
    status: number;
    code: string;
    message: string;
    username: string | null;
    created_at: string;
  }>;
  const errors = errorRows.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    method: row.method,
    path: row.path,
    status: row.status,
    code: row.code,
    message: row.message,
    username: row.username,
    createdAt: row.created_at,
  }));

  const moderationTotals = db
    .prepare(
      `SELECT COUNT(DISTINCT request_id) AS events, COUNT(DISTINCT user_id) AS users FROM moderation_events`,
    )
    .get() as unknown as { events: number; users: number };
  const errorTotal = db.prepare("SELECT COUNT(*) AS count FROM error_events").get() as unknown as {
    count: number;
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
      moderationEvents: moderationTotals.events,
      moderationUsers: moderationTotals.users,
      errorEvents: errorTotal.count,
    },
    users,
    keys,
    days,
    moderation,
    errors,
  };
}
