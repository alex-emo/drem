import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, newCustomerNo, type UserRow } from "./db.js";
import { hashPassword, verifyPassword } from "./password.js";
import { ApiError } from "./protocol.js";
import { config } from "./config.js";

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const DISPLAY_NAME_MAX = 40;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  createdAt: string;
  customerNo: string;
  isAdmin: boolean;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export function isAdminUsername(username: string): boolean {
  return config.adminUsers.some((name) => name.toLowerCase() === username.toLowerCase());
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    customerNo: row.customer_no ?? "",
    isAdmin: isAdminUsername(row.username),
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

function createSession(
  userId: string,
  deviceId: string | null,
  deviceName: string | null,
  platform: string | null,
): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  // 多设备：每个设备保留独立会话，互不踢出；过期会话由 requireUser 清理。
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, device_id, device_name, platform, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `sess_${randomUUID()}`,
    userId,
    hashToken(token),
    deviceId,
    deviceName,
    platform,
    now.toISOString(),
    now.toISOString(),
    expiresAt,
  );
  return token;
}

interface Credentials {
  username: string;
  password: string;
  displayName?: string;
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
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
  const deviceName = typeof body.deviceName === "string" ? body.deviceName.slice(0, 80) : null;
  const platform = typeof body.platform === "string" ? body.platform.slice(0, 32) : null;
  return { username, password, displayName: displayName || undefined, deviceId, deviceName, platform };
}

export async function registerUser(input: unknown): Promise<AuthResult> {
  const { username, password, displayName, deviceId, deviceName, platform } = parseCredentials(input, true);

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    throw new ApiError(409, "USERNAME_TAKEN", "这个用户名已经被注册");
  }

  const user: UserRow = {
    id: `user_${randomUUID()}`,
    username,
    display_name: displayName ?? null,
    password_hash: await hashPassword(password),
    created_at: new Date().toISOString(),
    customer_no: newCustomerNo(),
  };
  const backupKey = randomBytes(32).toString("hex");

  try {
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, created_at, customer_no, backup_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      user.id,
      user.username,
      user.display_name,
      user.password_hash,
      user.created_at,
      user.customer_no ?? "",
      backupKey,
    );
  } catch {
    throw new ApiError(409, "USERNAME_TAKEN", "这个用户名已经被注册");
  }

  return { token: createSession(user.id, deviceId, deviceName, platform), user: toPublic(user) };
}

export async function loginUser(input: unknown): Promise<AuthResult> {
  const { username, password, deviceId, deviceName, platform } = parseCredentials(input, false);
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
  }
  if (row.disabled) {
    throw new ApiError(403, "ACCOUNT_DISABLED", "账号已被管理员禁用");
  }

  return { token: createSession(row.id, deviceId, deviceName, platform), user: toPublic(row) };
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
      `SELECT u.*, s.id AS session_id, s.expires_at AS session_expires_at, s.last_seen_at AS session_last_seen_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | (UserRow & {
        session_id: string;
        session_expires_at: string | null;
        session_last_seen_at: string;
      })
    | undefined;

  if (!row) {
    throw new ApiError(401, "UNAUTHORIZED", "登录已失效，请重新登录");
  }
  if (row.session_expires_at && Date.parse(row.session_expires_at) <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.session_id);
    throw new ApiError(401, "UNAUTHORIZED", "登录已过期，请重新登录");
  }
  if (row.disabled) {
    throw new ApiError(403, "ACCOUNT_DISABLED", "账号已被管理员禁用");
  }

  // last_seen_at 不需要每个请求都写；60 秒节流足以支撑活跃统计，避免同步 SQLite 写放大。
  if (Date.now() - Date.parse(row.session_last_seen_at) > LAST_SEEN_THROTTLE_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      row.session_id,
    );
  }

  return { user: toPublic(row), sessionId: row.session_id };
}

/** 管理接口：在登录基础上校验管理员名单。 */
export function requireAdmin(authorization: string | undefined): PublicUser {
  const { user } = requireUser(authorization);
  if (!user.isAdmin) {
    throw new ApiError(403, "FORBIDDEN", "需要管理员权限");
  }
  return user;
}

export function logoutUser(authorization: string | undefined): void {
  const header = authorization ?? "";
  if (!header.startsWith("Bearer ")) return;
  const token = header.slice(7).trim();
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}


export function adminSetUserDisabled(id: string, disabled: boolean): PublicUser {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "用户不存在");
  db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
  if (disabled) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  return toPublic({ ...row, disabled: disabled ? 1 : 0 });
}

export function adminSetUserVerified(id: string, verified: boolean): PublicUser {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "用户不存在");
  db.prepare("UPDATE users SET verified = ? WHERE id = ?").run(verified ? 1 : 0, id);
  return toPublic({ ...row, verified: verified ? 1 : 0 });
}

export async function adminResetPassword(id: string, password: string): Promise<void> {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new ApiError(400, "INVALID_ARGUMENT", `密码长度需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 位`);
  }
  const row = db.prepare("SELECT id FROM users WHERE id = ?").get(id) as { id: string } | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "用户不存在");
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(password), id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

export function adminRevokeSessions(id: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

export function getBackupKey(userId: string): { key: string; legacyKey?: string } {
  const row = db
    .prepare("SELECT verified, backup_key, backup_key_legacy FROM users WHERE id = ?")
    .get(userId) as
    | { verified?: number; backup_key?: string | null; backup_key_legacy?: string | null }
    | undefined;
  if (row && row.verified === 0) {
    // 对外不暴露“验证”概念，只提示账号暂不可用；后台可见 ACCOUNT_UNVERIFIED。
    throw new ApiError(403, "ACCOUNT_UNVERIFIED", "账号暂时不可用，请联系管理员。");
  }
  const current = row?.backup_key ?? null;
  if (current && current.length >= 64) {
    return { key: current, ...(row?.backup_key_legacy ? { legacyKey: row.backup_key_legacy } : {}) };
  }
  // 旧版是 10 位十六进制；登录时升级为 32 字节（64 hex），旧密钥保留到客户端完成重加密。
  const key = randomBytes(32).toString("hex");
  db.prepare("UPDATE users SET backup_key = ?, backup_key_legacy = ? WHERE id = ?").run(
    key,
    current,
    userId,
  );
  return { key, ...(current ? { legacyKey: current } : {}) };
}

export function clearBackupLegacy(userId: string): void {
  db.prepare("UPDATE users SET backup_key_legacy = NULL WHERE id = ?").run(userId);
}
