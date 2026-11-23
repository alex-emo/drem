import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, registerTestUser } from "./helpers/api.js";
import { sharedTestServer, stopSharedTestServer, type TestServer } from "./helpers/server.js";

let server: TestServer;
let client: ApiClient;
let adminToken: string;

beforeAll(async () => {
  server = await sharedTestServer();
  client = new ApiClient(server.baseUrl);
  const admin = await client.post("/api/v1/auth/register", { username: "admin_test", password: "password123" });
  adminToken = admin.body.token;
});

afterAll(async () => {
  await stopSharedTestServer();
});

async function login(username: string, password: string) {
  return client.post("/api/v1/auth/login", { username, password });
}

describe("管理员用户管理", () => {
  it("禁用用户后其会话失效且无法登录，重新启用后可登录", async () => {
    const target = await registerTestUser(client, "ban");
    const disabled = await client.request("PATCH", `/api/v1/admin/users/${target.user.id}`, {
      token: adminToken,
      body: { disabled: true },
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ username: target.user.username, id: target.user.id });

    expect((await client.get("/api/v1/me", { token: target.token })).status).toBe(401);
    const blocked = await login(target.user.username, "password123");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("ACCOUNT_DISABLED");

    await client.request("PATCH", `/api/v1/admin/users/${target.user.id}`, {
      token: adminToken,
      body: { disabled: false },
    });
    expect((await login(target.user.username, "password123")).status).toBe(200);
  });

  it("管理员不能禁用自己", async () => {
    const me = await client.get("/api/v1/me", { token: adminToken });
    const response = await client.request("PATCH", `/api/v1/admin/users/${me.body.user.id}`, {
      token: adminToken,
      body: { disabled: true },
    });
    expect(response.status).toBe(400);
  });

  it("PATCH 参数非法返回 400", async () => {
    const target = await registerTestUser(client, "bad");
    const response = await client.request("PATCH", `/api/v1/admin/users/${target.user.id}`, {
      token: adminToken,
      body: { disabled: "yes" },
    });
    expect(response.status).toBe(400);
  });

  it("撤销会话后旧 token 失效", async () => {
    const target = await registerTestUser(client, "revoke");
    expect((await client.get("/api/v1/me", { token: target.token })).status).toBe(200);
    const revoked = await client.post(`/api/v1/admin/users/${target.user.id}/revoke`, {}, { token: adminToken });
    expect(revoked.status).toBe(200);
    expect((await client.get("/api/v1/me", { token: target.token })).status).toBe(401);
  });

  it("重置密码：旧密码失效、新密码可登录、短密码被拒绝", async () => {
    const target = await registerTestUser(client, "reset");
    const tooShort = await client.post(
      `/api/v1/admin/users/${target.user.id}/password`,
      { password: "short" },
      { token: adminToken },
    );
    expect(tooShort.status).toBe(400);

    const reset = await client.post(
      `/api/v1/admin/users/${target.user.id}/password`,
      { password: "brand-new-pass" },
      { token: adminToken },
    );
    expect(reset.status).toBe(200);
    expect((await login(target.user.username, "password123")).status).toBe(401);
    expect((await login(target.user.username, "brand-new-pass")).status).toBe(200);
  });

  it("操作不存在的用户返回 404", async () => {
    const response = await client.request("PATCH", "/api/v1/admin/users/user_missing", {
      token: adminToken,
      body: { disabled: true },
    });
    expect(response.status).toBe(404);
  });
});

describe("公告管理", () => {
  it("创建后可更新，公开接口只返回启用中的最新公告", async () => {
    const created = await client.post(
      "/api/v1/admin/announcements",
      { title: "旧公告", body: "旧内容", active: true },
      { token: adminToken },
    );
    expect(created.status).toBe(201);
    const id = created.body.announcement.id;

    const updated = await client.request("PATCH", `/api/v1/admin/announcements/${id}`, {
      token: adminToken,
      body: { title: "新公告", body: "新内容", active: true },
    });
    expect(updated.status).toBe(200);
    expect((await client.get("/api/v1/announcement")).body.announcement).toMatchObject({
      title: "新公告",
      body: "新内容",
    });

    const list = await client.get("/api/v1/admin/announcements", { token: adminToken });
    expect(list.body.announcements.some((item: { id: number }) => item.id === id)).toBe(true);
  });

  it("公告内容为空返回 400", async () => {
    const response = await client.post("/api/v1/admin/announcements", { title: "x", body: "   " }, { token: adminToken });
    expect(response.status).toBe(400);
  });

  it("不存在的公告返回 404", async () => {
    const response = await client.request("PATCH", "/api/v1/admin/announcements/999999", {
      token: adminToken,
      body: { title: "x", body: "y" },
    });
    expect(response.status).toBe(404);
  });
});

describe("旧版 base64 备份接口", () => {
  it("PUT/GET /api/v1/backup 往返 payload", async () => {
    const { token } = await registerTestUser(client, "legacy");
    const put = await client.put("/api/v1/backup", { payload: "dream1.abc.def" }, { token });
    expect(put.status).toBe(200);
    expect(put.body.size).toBe("dream1.abc.def".length);
    const get = await client.get("/api/v1/backup", { token });
    expect(get.body.backup).toMatchObject({ payload: "dream1.abc.def" });
    expect(get.body.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("空 payload 返回 400，未登录返回 401", async () => {
    const { token } = await registerTestUser(client, "legacy2");
    expect((await client.put("/api/v1/backup", { payload: "" }, { token })).status).toBe(400);
    expect((await client.put("/api/v1/backup", { payload: "x" })).status).toBe(401);
  });
});
