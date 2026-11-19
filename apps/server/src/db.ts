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
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string | null;
  created_at: string;
  last_seen_at: string;
}

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
