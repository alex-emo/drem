import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, type UserRow } from "./db.js";
import { hashPassword, verifyPassword } from "./password.js";
import { ApiError } from "./protocol.js";

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const DISPLAY_NAME_MAX = 40;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  createdAt: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createSession(userId: string, deviceId: string | null): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, device_id, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`sess_${randomUUID()}`, userId, hashToken(token), deviceId, now, now);
  return token;
}

interface Credentials {
  username: string;
  password: string;
  displayName?: string;
  deviceId: string | null;
}

function parseCredentials(input: unknown, allowDisplayName: boolean): Credentials {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "INVALID_ARGUMENT", "请求体必须是 JSON 对象");
  }
  const body = input as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!USERNAME_RE.test(username)) {
    throw new ApiError(400, "INVALID_ARGUMENT", "用户名需为 3–32 位字母、数字、下划线或中文", [
      { field: "username", reason: "invalid_format" },
    ]);
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new ApiError(400, "INVALID_ARGUMENT", "密码长度需在 8–128 位之间", [
      { field: "password", reason: "invalid_length" },
    ]);
  }

  const displayName =
    allowDisplayName && typeof body.displayName === "string" ? body.displayName.trim() : undefined;
  if (displayName && displayName.length > DISPLAY_NAME_MAX) {
    throw new ApiError(400, "INVALID_ARGUMENT", "昵称最多 40 个字符", [
      { field: "displayName", reason: "too_long" },
    ]);
  }

  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 128) : null;
  return { username, password, displayName: displayName || undefined, deviceId };
}

export function registerUser(input: unknown): AuthResult {
  const { username, password, displayName, deviceId } = parseCredentials(input, true);

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    throw new ApiError(409, "USERNAME_TAKEN", "这个用户名已经被注册");
  }

  const user: UserRow = {
    id: `user_${randomUUID()}`,
    username,
    display_name: displayName ?? null,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };

  try {
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(user.id, user.username, user.display_name, user.password_hash, user.created_at);
  } catch {
    throw new ApiError(409, "USERNAME_TAKEN", "这个用户名已经被注册");
  }

  return { token: createSession(user.id, deviceId), user: toPublic(user) };
}

export function loginUser(input: unknown): AuthResult {
  const { username, password, deviceId } = parseCredentials(input, false);
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
  }

  return { token: createSession(row.id, deviceId), user: toPublic(row) };
}

export function requireUser(authorization: string | undefined): {
  user: PublicUser;
  sessionId: string;
} {
  const header = authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new ApiError(401, "UNAUTHORIZED", "请先登录");
  }
  const token = header.slice(7).trim();
  if (token.length < 20) {
    throw new ApiError(401, "UNAUTHORIZED", "登录凭证无效");
  }

  const row = db
    .prepare(
      `SELECT u.*, s.id AS session_id FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as (UserRow & { session_id: string }) | undefined;

  if (!row) {
    throw new ApiError(401, "UNAUTHORIZED", "登录已失效，请重新登录");
  }

  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    row.session_id,
  );

  return { user: toPublic(row), sessionId: row.session_id };
}

export function logoutUser(authorization: string | undefined): void {
  const header = authorization ?? "";
  if (!header.startsWith("Bearer ")) return;
  const token = header.slice(7).trim();
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}
