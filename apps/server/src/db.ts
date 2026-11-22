import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

const dbPath = resolve(config.dbPath);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    device_id    TEXT,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

export interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  password_hash: string;
  created_at: string;
  disabled?: number;
  backup_key?: string | null;
  backup_key_legacy?: string | null;
}

// 兼容旧库：增加禁用标记。
const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
if (!userColumns.some((column) => column.name === "disabled")) {
  db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.some((column) => column.name === "backup_key")) {
  db.exec("ALTER TABLE users ADD COLUMN backup_key TEXT");
}
if (!userColumns.some((column) => column.name === "backup_key_legacy")) {
  db.exec("ALTER TABLE users ADD COLUMN backup_key_legacy TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_backups (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload    TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    size       INTEGER NOT NULL DEFAULT 0
  );
`);

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string | null;
  created_at: string;
  last_seen_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           TEXT NOT NULL,
    username          TEXT NOT NULL,
    key_id            INTEGER NOT NULL,
    model             TEXT NOT NULL,
    kind              TEXT NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_usage_key ON usage_events(key_id);
  CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS context_summaries (
    key        TEXT PRIMARY KEY,
    summary    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

/** 读取某段对话的压缩摘要缓存。 */
export function getContextSummary(key: string): string | null {
  const row = db.prepare("SELECT summary FROM context_summaries WHERE key = ?").get(key) as
    | { summary?: string }
    | undefined;
  return row?.summary ?? null;
}

/** 写入压缩摘要缓存（同段内容只算一次）。 */
export function putContextSummary(key: string, summary: string): void {
  db.prepare(
    `INSERT INTO context_summaries (key, summary, created_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET summary = excluded.summary`,
  ).run(key, summary, Date.now());
}

db.exec(`
  CREATE TABLE IF NOT EXISTS moderation_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL,
    username      TEXT NOT NULL,
    request_id    TEXT NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT,
    stage         TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    detail        TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_moderation_user ON moderation_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_moderation_created ON moderation_events(created_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS error_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    method     TEXT NOT NULL,
    path       TEXT NOT NULL,
    status     INTEGER NOT NULL,
    code       TEXT NOT NULL,
    message    TEXT NOT NULL,
    username   TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_error_created ON error_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_error_code ON error_events(code);
`);

export interface FileRow {
  id: string;
  user_id: string;
  name: string;
  bytes: number;
  chars: number;
  content: string;
  created_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    chars      INTEGER NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
`);

export function putFile(row: FileRow): void {
  db.prepare(
    `INSERT INTO files (id, user_id, name, bytes, chars, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.user_id, row.name, row.bytes, row.chars, row.content, row.created_at);
}

export function listFiles(userId: string): FileRow[] {
  return db
    .prepare("SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as unknown as FileRow[];
}

export function getFiles(userId: string, ids: string[]): FileRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM files WHERE user_id = ? AND id IN (${placeholders})`)
    .all(userId, ...ids) as unknown as FileRow[];
}

export function deleteFile(userId: string, id: string): boolean {
  return db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}
