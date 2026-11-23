import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, registerTestUser } from "./helpers/api.js";
import { sharedTestServer, stopSharedTestServer, type TestServer } from "./helpers/server.js";

let server: TestServer;
let client: ApiClient;

beforeAll(async () => {
  server = await sharedTestServer();
  client = new ApiClient(server.baseUrl);
});

afterAll(async () => {
  await stopSharedTestServer();
});

describe("健康检查与元信息", () => {
  it("GET /api/v1/health 返回版本、mock 标记和上下文阈值", async () => {
    const response = await client.get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      apiVersion: "v1",
      serverVersion: "0.2.0",
      mock: true,
    });
    expect(response.body.provider).toBeUndefined();
    expect(response.body.providerLabel).toBeUndefined();
    expect(response.body.context).toMatchObject({
      compressAfterMessages: 400,
      compressAfterTokens: 60_000,
      tokenLimit: 96_000,
    });
    expect(typeof response.body.serverTime).toBe("string");
  });

  it("每个响应都带 X-Request-Id 与 X-Api-Version，并允许跨域", async () => {
    const response = await client.get("/api/v1/health", {
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("x-api-version")).toBe("v1");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("GET /api/v1/models 返回默认与思考模型", async () => {
    const response = await client.get("/api/v1/models");
    expect(response.status).toBe(200);
    expect(response.body.provider).toBeUndefined();
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].id).toBe("dream");
    expect(response.body.data[1].id).toBe("dream-thinking");
    expect(response.body.data[0]).toMatchObject({ thinking: false, default: true });
    expect(response.body.data[1]).toMatchObject({ thinking: true, default: false });
  });

  it("GET /api/v1/announcement 无公告时返回 null", async () => {
    const response = await client.get("/api/v1/announcement");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ announcement: null });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("错误处理", () => {
  it("未知路由返回 404 NOT_FOUND", async () => {
    const response = await client.get("/api/v1/nope");
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "NOT_FOUND", hex: "0x3001" });
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("JSON 接口拒绝非 application/json", async () => {
    const response = await client.request("POST", "/api/v1/auth/register", {
      rawBody: "username=x",
      headers: { "content-type": "text/plain" },
    });
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("非法 JSON 返回 400 INVALID_ARGUMENT", async () => {
    const response = await client.request("POST", "/api/v1/auth/register", {
      rawBody: "{broken",
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("缺少鉴权返回 401", async () => {
    const response = await client.get("/api/v1/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("普通用户访问管理接口返回 403", async () => {
    const { token } = await registerTestUser(client);
    const response = await client.get("/api/v1/admin/stats", { token });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});

describe("注册 / 登录 / 会话", () => {
  it("注册返回 201 与 token，/me 可读取用户", async () => {
    const registered = await registerTestUser(client, "flow");
    expect(registered.token.length).toBeGreaterThan(20);
    const me = await client.get("/api/v1/me", { token: registered.token });
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ username: registered.user.username, isAdmin: false });
    expect(JSON.stringify(me.body)).not.toContain("password");
  });

  it("重复用户名返回 409 USERNAME_TAKEN", async () => {
    const first = await registerTestUser(client, "dup");
    const response = await client.post("/api/v1/auth/register", {
      username: first.user.username,
      password: "password123",
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("USERNAME_TAKEN");
  });

  it("错误密码返回 401 INVALID_CREDENTIALS", async () => {
    const registered = await registerTestUser(client, "pwd");
    const response = await client.post("/api/v1/auth/login", {
      username: registered.user.username,
      password: "wrong-password",
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("logout 后 token 失效", async () => {
    const { token } = await registerTestUser(client, "logout");
    expect((await client.post("/api/v1/auth/logout", {}, { token })).status).toBe(200);
    expect((await client.get("/api/v1/me", { token })).status).toBe(401);
  });
});

describe("文件上传", () => {
  async function uploadText(token: string, name: string, content: string) {
    const form = new FormData();
    form.set("file", new File([content], name, { type: "text/plain" }));
    const response = await fetch(`${server.baseUrl}/api/v1/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  it("上传文本 → 列表 → 删除", async () => {
    const { token } = await registerTestUser(client, "files");
    const uploaded = await uploadText(token, "note.md", "# 标题\n内容");
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ name: "note.md", chars: 7 });
    const list = await client.get("/api/v1/files", { token });
    expect(list.body.files.map((file: { id: string }) => file.id)).toContain(uploaded.body.id);
    const removed = await client.delete(`/api/v1/files/${uploaded.body.id}`, { token });
    expect(removed.status).toBe(200);
    const missing = await client.delete(`/api/v1/files/${uploaded.body.id}`, { token });
    expect(missing.status).toBe(404);
  });

  it("缺少 file 字段返回 400", async () => {
    const { token } = await registerTestUser(client, "files2");
    const form = new FormData();
    form.set("other", "x");
    const response = await fetch(`${server.baseUrl}/api/v1/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    expect(response.status).toBe(400);
  });

  it("未登录上传返回 401", async () => {
    const response = await uploadText("invalid-token-value-123456", "a.txt", "x");
    expect(response.status).toBe(401);
  });
});

describe("云备份（流式）", () => {
  it("上传备份 → meta → 下载原始字节", async () => {
    const { token } = await registerTestUser(client, "backup");
    const iv = Buffer.alloc(12, 7).toString("base64");
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const put = await client.request("PUT", "/api/v1/backup/stream", {
      token,
      rawBody: payload,
      headers: { "content-type": "application/octet-stream", "x-backup-iv": iv, "x-backup-encoding": "gzip" },
    });
    expect(put.status).toBe(200);
    expect(put.body.size).toBe(5);

    const meta = await client.get("/api/v1/backup/meta", { token });
    expect(meta.status).toBe(200);
    expect(meta.body.key).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.body.backup).toMatchObject({ size: 5, iv, version: 2 });

    const download = await fetch(`${server.baseUrl}/api/v1/backup/stream`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("x-backup-iv")).toBe(iv);
    expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual([1, 2, 3, 4, 5]);
  });

  it("IV 长度不对返回 400", async () => {
    const { token } = await registerTestUser(client, "backup2");
    const response = await client.request("PUT", "/api/v1/backup/stream", {
      token,
      rawBody: new Uint8Array([1]),
      headers: { "content-type": "application/octet-stream", "x-backup-iv": "short" },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("错误 content-type 返回 415", async () => {
    const { token } = await registerTestUser(client, "backup3");
    const response = await client.request("PUT", "/api/v1/backup/stream", {
      token,
      rawBody: "x",
      headers: { "content-type": "text/plain", "x-backup-iv": Buffer.alloc(12).toString("base64") },
    });
    expect(response.status).toBe(415);
  });

  it("没有备份时下载返回 404", async () => {
    const { token } = await registerTestUser(client, "backup4");
    expect((await client.get("/api/v1/backup/stream", { token })).status).toBe(404);
  });
});

describe("管理接口", () => {
  it("管理员可读统计、日志、模型设置并修改设置", async () => {
    const admin = await client.post("/api/v1/auth/register", {
      username: "admin_test",
      password: "password123",
    });
    expect(admin.status).toBe(201);
    expect(admin.body.user.isAdmin).toBe(true);
    const token = admin.body.token;

    const stats = await client.get("/api/v1/admin/stats", { token });
    expect(stats.status).toBe(200);
    expect(stats.body).toHaveProperty("totals");

    const logs = await client.get("/api/v1/admin/logs?limit=5", { token });
    expect(logs.status).toBe(200);
    expect(Array.isArray(logs.body.items)).toBe(true);
    expect(logs.body.items.length).toBeLessThanOrEqual(5);

    const before = await client.get("/api/v1/admin/model-settings", { token });
    expect(before.body.settings).toHaveProperty("temperature");

    const updated = await client.put(
      "/api/v1/admin/model-settings",
      { temperature: 1.1, identityPrompt: "你是 Dream 模型。" },
      { token },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.settings).toMatchObject({ temperature: 1.1, identityPrompt: "你是 Dream 模型。" });

    const invalid = await client.put("/api/v1/admin/model-settings", { temperature: "hot" }, { token });
    expect(invalid.status).toBe(400);
  });

  it("管理员可创建/更新/删除公告，公开接口返回最新公告", async () => {
    const admin = await client.post("/api/v1/auth/login", { username: "admin_test", password: "password123" });
    const token = admin.body.token;
    const created = await client.post(
      "/api/v1/admin/announcements",
      { title: "维护通知", body: "今晚 23:00 维护", active: true },
      { token },
    );
    expect(created.status).toBe(201);
    const publicView = await client.get("/api/v1/announcement");
    expect(publicView.body.announcement).toMatchObject({ title: "维护通知", body: "今晚 23:00 维护" });
    const removed = await client.delete(`/api/v1/admin/announcements/${created.body.announcement.id}`, { token });
    expect(removed.status).toBe(200);
  });
});
