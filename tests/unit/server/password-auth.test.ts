import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../apps/server/src/password.js";
import {
  adminResetPassword,
  adminRevokeSessions,
  adminSetUserDisabled,
  getBackupKey,
  isAdminUsername,
  loginUser,
  logoutUser,
  registerUser,
  requireAdmin,
  requireUser,
} from "../../../apps/server/src/auth.js";
import { db } from "../../../apps/server/src/db.js";
import { ApiError } from "../../../apps/server/src/protocol.js";
import { createTestUser } from "../../helpers/fixtures.js";

describe("password", () => {
  it("哈希格式为 scrypt$N$r$p$salt$hash 且每次加盐不同", async () => {
    const a = await hashPassword("password123");
    const b = await hashPassword("password123");
    expect(a).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("password123", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
  });

  it("拒绝格式损坏或非 scrypt 的存储值", async () => {
    for (const stored of ["", "plain", "bcrypt$x$y$z$a$b", "scrypt$x$y$z$a$b"]) {
      expect(await verifyPassword("password123", stored)).toBe(false);
    }
  });
});

describe("账号注册 / 登录", () => {
  it("注册返回 token 与公开用户信息，密码不落明文", async () => {
    const username = `reg${Date.now().toString(36).slice(-8)}`;
    const { token, user } = await registerUser({ username, password: "password123", displayName: "小明" });
    expect(token.length).toBeGreaterThan(20);
    expect(user.username).toBe(username);
    expect(user.displayName).toBe("小明");
    expect(user.isAdmin).toBe(false);
    expect(user).not.toHaveProperty("passwordHash");
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as { password_hash: string };
    expect(row.password_hash.startsWith("scrypt$")).toBe(true);
    expect(row.password_hash).not.toContain("password123");
  });

  it("用户名大小写不敏感地查重", async () => {
    const username = `dup${Date.now().toString(36).slice(-8)}`;
    await registerUser({ username, password: "password123" });
    await expect(registerUser({ username: username.toUpperCase(), password: "password123" })).rejects.toMatchObject({
      code: "USERNAME_TAKEN",
      status: 409,
    });
  });

  it("校验用户名与密码格式", async () => {
    await expect(registerUser({ username: "ab", password: "password123" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(registerUser({ username: "okname", password: "short" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(registerUser({ username: "okname", password: "x".repeat(129) })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(registerUser(null)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("登录成功 / 密码错误 / 用户不存在", async () => {
    const { user } = await createTestUser("login");
    const ok = await loginUser({ username: user.username, password: "password123" });
    expect(ok.user.id).toBe(user.id);
    await expect(loginUser({ username: user.username, password: "wrongpass" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await expect(loginUser({ username: "no_such_user_x", password: "password123" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("单设备登录会作废旧 token", async () => {
    const { user } = await createTestUser("single");
    const first = await loginUser({ username: user.username, password: "password123" });
    const second = await loginUser({ username: user.username, password: "password123" });
    expect(() => requireUser(`Bearer ${first.token}`)).toThrowError(/失效|登录/);
    expect(requireUser(`Bearer ${second.token}`).user.id).toBe(user.id);
  });
});

describe("requireUser / requireAdmin", () => {
  it("缺少或格式错误的 Authorization 返回 401", () => {
    for (const header of [undefined, "", "Bearer", "Bearer ", "Basic abc", "Bearer not-a-token"]) {
      try {
        requireUser(header);
        throw new Error("expected throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
      }
    }
  });

  it("非管理员调用 requireAdmin 返回 403", async () => {
    const { token } = await createTestUser("plain");
    expect(() => requireAdmin(`Bearer ${token}`)).toThrowError(/权限/);
  });

  it("管理员白名单大小写不敏感", () => {
    expect(isAdminUsername("ADMIN_TEST")).toBe(true);
    expect(isAdminUsername("nobody")).toBe(false);
  });

  it("logout 后 token 失效", async () => {
    const { token } = await createTestUser("logout");
    logoutUser(`Bearer ${token}`);
    expect(() => requireUser(`Bearer ${token}`)).toThrowError(/失效/);
  });
});

describe("管理员操作", () => {
  it("禁用账号后登录被拒绝，已有会话被清空", async () => {
    const { user, token } = await createTestUser("ban");
    adminSetUserDisabled(user.id, true);
    await expect(loginUser({ username: user.username, password: "password123" })).rejects.toMatchObject({
      code: "ACCOUNT_DISABLED",
      status: 403,
    });
    // 禁用会同时删除该用户全部 session。
    expect(() => requireUser(`Bearer ${token}`)).toThrowError(/登录已失效/);
    adminSetUserDisabled(user.id, false);
    const relogin = await loginUser({ username: user.username, password: "password123" });
    expect(relogin.user.id).toBe(user.id);
  });

  it("撤销全部会话后旧 token 失效", async () => {
    const { user, token } = await createTestUser("revoke");
    adminRevokeSessions(user.id);
    expect(() => requireUser(`Bearer ${token}`)).toThrowError(/失效|设备/);
  });

  it("重置密码后旧密码失效、新密码可用", async () => {
    const { token } = await createTestUser("reset");
    const user = requireUser(`Bearer ${token}`).user;
    await adminResetPassword(user.id, "newpassword456");
    await expect(loginUser({ username: user.username, password: "password123" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    const result = await loginUser({ username: user.username, password: "newpassword456" });
    expect(result.user.id).toBe(user.id);
  });
});

describe("备份密钥", () => {
  it("首次获取生成 64 位十六进制密钥并保持稳定", async () => {
    const { user } = await createTestUser("backupkey");
    const first = getBackupKey(user.id);
    expect(first.key).toMatch(/^[0-9a-f]{64}$/);
    expect(getBackupKey(user.id).key).toBe(first.key);
  });

  it("不同用户密钥不同", async () => {
    const a = getBackupKey((await createTestUser("bk1")).user.id).key;
    const b = getBackupKey((await createTestUser("bk2")).user.id).key;
    expect(a).not.toBe(b);
  });
});
