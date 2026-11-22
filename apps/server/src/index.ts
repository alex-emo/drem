import { gunzipSync } from "node:zlib";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { config } from "./config.js";
import { keyPool } from "./keys.js";
import {
  COMPRESS_CHAR_THRESHOLD,
  COMPRESS_MESSAGE_THRESHOLD,
  compressContext,
  needsCompression,
} from "./context.js";
import {
  loginUser,
  logoutUser,
  isAdminUsername,
  registerUser,
  adminResetPassword,
  adminRevokeSessions,
  adminSetUserDisabled,
  requireAdmin,
  requireUser,
} from "./auth.js";
import { parseChatRequest, openChatStream } from "./deepseek.js";
import { createTextFile, deleteUserFile, expandFiles, listUserFiles, MAX_FILE_BYTES } from "./files.js";
import { openSearchStream } from "./search.js";
import { fetchSharedChat } from "./share.js";
import { mockChatStream } from "./mock.js";
import {
  API_VERSION,
  ApiError,
  MAX_BODY_BYTES,
  MAX_BODY_MIB,
  SERVER_VERSION,
  errorBody,
  sseHeaders,
} from "./protocol.js";
import { dreamChatStream, refusalStream } from "./stream.js";
import {
  getAdminStats,
  recordError,
  recordModeration,
  recordUsage,
  type TokenUsage,
} from "./usage.js";
import { listLogs, pushLog } from "./logs.js";

type AppEnv = { Variables: { requestId: string; requestUser?: string } };

const app = new Hono<AppEnv>();

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

app.use("*", logger());

// 请求 ID：客户端可传，服务端负责生成与回传，便于日志关联。
app.use("/api/*", async (c, next) => {
  const incoming = c.req.header("x-request-id") ?? "";
  const requestId = REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  c.header("x-api-version", API_VERSION);
  await next();
});

app.use("/api/*", async (c, next) => {
  const started = performance.now();
  await next();
  if (c.req.path === "/api/v1/health") return;
  const status = c.res.status;
  pushLog({
    level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
    requestId: c.get("requestId") ?? "",
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs: Math.round(performance.now() - started),
    username: c.get("requestUser"),
  });
});

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "Content-Type",
      "Accept",
      "X-Request-Id",
      "Authorization",
      "X-Api-Key",
      "Anthropic-Beta",
    ],
    exposeHeaders: ["X-Request-Id", "X-Api-Version"],
  }),
);

async function readJsonBody(c: Context<AppEnv>): Promise<unknown> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType && !/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type 必须是 application/json");
  }

  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `请求体超过 ${MAX_BODY_MIB} MiB 上限`);
  }

  const encoding = (c.req.header("content-encoding") ?? "").trim().toLowerCase();
  if (encoding && encoding !== "gzip") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "只支持 gzip 编码的请求体");
  }

  let bytes = Buffer.from(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `请求体超过 ${MAX_BODY_MIB} MiB 上限`);
  }
  if (encoding === "gzip") {
    const before = bytes.byteLength;
    try {
      bytes = gunzipSync(bytes, { maxOutputLength: MAX_BODY_BYTES });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", `解压后超过 ${MAX_BODY_MIB} MiB 上限`);
      }
      throw new ApiError(400, "INVALID_ARGUMENT", "gzip 解压失败");
    }
    if (bytes.byteLength > MAX_BODY_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", `解压后超过 ${MAX_BODY_MIB} MiB 上限`);
    }
    console.info(`[dream-server] gzip body ${before} -> ${bytes.byteLength} bytes`);
  }
  const text = bytes.toString("utf8");

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_ARGUMENT", "请求体不是合法的 JSON");
  }
}

app.get("/api/v1/health", (c) => {
  const keys = keyPool.stats();
  const hasApiKey = keys.total > 0;
  return c.json({
    status: config.mock || keys.available === 0 ? "degraded" : "ok",
    apiVersion: API_VERSION,
    serverVersion: SERVER_VERSION,
    serverTime: new Date().toISOString(),
    mock: config.mock,
    provider: config.provider,
    providerLabel: config.providerLabel,
    hasApiKey,
    keys,
    models: {
      default: config.model,
      reasoner: config.reasonerModel,
    },
    context: {
      compressAfterMessages: COMPRESS_MESSAGE_THRESHOLD,
      compressAfterChars: COMPRESS_CHAR_THRESHOLD,
    },
    features: {
      files: true,
      webSearch: config.provider === "qwen",
    },
  });
});

// 官方 chat-demo 的附件上传路径是 /anthropic/v1/files；移动 App 直接复用它的上传逻辑。
app.post("/anthropic/v1/files", async (c) => {
  const authorization = c.req.header("authorization") ?? `Bearer ${c.req.header("x-api-key") ?? ""}`;
  const { user } = requireUser(authorization);
  const declaredLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES + 1024 * 1024) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "文件超过 10 MiB 上限");
  }
  const body = await c.req.parseBody();
  const entry = body["file"];
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
    throw new ApiError(400, "INVALID_ARGUMENT", "缺少 file 字段");
  }
  const created = createTextFile(user.id, entry.name || "未命名文本", new Uint8Array(await entry.arrayBuffer()));
  return c.json({
    id: created.id,
    type: "file",
    size_bytes: created.bytes,
    created_at: created.createdAt,
    filename: created.name,
    mime_type: "text/plain",
  }, 201);
});

app.delete("/anthropic/v1/files/:id", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  deleteUserFile(user.id, c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/v1/files", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  return c.json({ files: listUserFiles(user.id) });
});

app.post("/api/v1/files", async (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 1024 * 1024) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "文件超过 10 MiB 上限");
  }
  const body = await c.req.parseBody();
  const entry = body["file"];
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
    throw new ApiError(400, "INVALID_ARGUMENT", "缺少 file 字段");
  }
  const bytes = new Uint8Array(await entry.arrayBuffer());
  return c.json(createTextFile(user.id, entry.name || "未命名文本", bytes), 201);
});

app.delete("/api/v1/files/:id", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  if (!deleteUserFile(user.id, c.req.param("id"))) {
    throw new ApiError(404, "NOT_FOUND", "文件不存在");
  }
  return c.json({ ok: true });
});

app.get("/api/v1/version", (c) => {
  const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
  const host = c.req.header("host") ?? new URL(c.req.url).host;
  return c.json({
    version: config.appVersion,
    apkUrl: `${proto}://${host}/download/dream-android.apk?v=${config.appVersion}`,
    notes: "聊天手感优化、分享链接导入、应用内更新提示。",
    publishedAt: "2026-11-22",
  });
});

app.get("/api/v1/models", (c) =>
  c.json({
    data:
      config.provider === "qwen"
        ? [{ id: config.model, thinking: "auto", default: true }]
        : [
            { id: config.model, thinking: false, default: true },
            { id: config.reasonerModel, thinking: true, default: false },
          ],
    provider: config.provider,
  }),
);

app.post("/api/v1/auth/register", async (c) => {
  const body = await readJsonBody(c);
  return c.json(registerUser(body), 201);
});

app.post("/api/v1/auth/login", async (c) => {
  const body = await readJsonBody(c);
  return c.json(loginUser(body));
});

app.post("/api/v1/auth/logout", (c) => {
  logoutUser(c.req.header("authorization"));
  return c.json({ ok: true });
});

app.get("/api/v1/me", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  return c.json({ user });
});

app.get("/api/v1/admin/stats", (c) => {
  requireAdmin(c.req.header("authorization"));
  return c.json(getAdminStats(isAdminUsername));
});

app.get("/api/v1/admin/logs", (c) => {
  requireAdmin(c.req.header("authorization"));
  const limit = Number(c.req.query("limit") ?? "200");
  return c.json(
    listLogs({
      level: c.req.query("level"),
      search: c.req.query("search"),
      sort: (c.req.query("sort") ?? "time") as "time" | "status" | "duration" | "path",
      order: c.req.query("order") === "asc" ? "asc" : "desc",
      limit: Number.isFinite(limit) ? limit : 200,
    }),
  );
});

app.patch("/api/v1/admin/users/:id", async (c) => {
  const admin = requireAdmin(c.req.header("authorization"));
  const id = c.req.param("id");
  const body = (await readJsonBody(c)) as { disabled?: unknown };
  if (typeof body.disabled !== "boolean") {
    throw new ApiError(400, "INVALID_ARGUMENT", "disabled 必须是布尔值");
  }
  if (body.disabled && id === admin.id) {
    throw new ApiError(400, "INVALID_ARGUMENT", "不能禁用当前登录的管理员账号");
  }
  return c.json(adminSetUserDisabled(id, body.disabled));
});

app.post("/api/v1/admin/users/:id/password", async (c) => {
  requireAdmin(c.req.header("authorization"));
  const body = (await readJsonBody(c)) as { password?: unknown };
  if (typeof body.password !== "string") {
    throw new ApiError(400, "INVALID_ARGUMENT", "password 必须是字符串");
  }
  adminResetPassword(c.req.param("id"), body.password);
  return c.json({ ok: true });
});

app.post("/api/v1/admin/users/:id/revoke", (c) => {
  requireAdmin(c.req.header("authorization"));
  adminRevokeSessions(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/v1/import/share", async (c) => {
  requireUser(c.req.header("authorization"));
  const url = c.req.query("url") ?? "";
  return c.json(await fetchSharedChat(url));
});

app.post("/api/v1/context/warm", async (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const body = await readJsonBody(c);
  const parsed = parseChatRequest(body, { requireLastUser: false });
  const outcome = await compressContext(parsed.messages, {
    onUsage: (usage: TokenUsage | null, keyId: number) =>
      recordUsage({
        userId: user.id,
        username: user.username,
        keyId,
        model: config.model,
        kind: "summary",
        usage,
      }),
  });
  return c.json({
    compressed: outcome.compressed,
    segments: outcome.segments,
    cached: outcome.cached,
    originalMessages: outcome.originalMessages,
  });
});

/** 对外 SSE 只暴露 Dream 模型名，不暴露真实上游模型。 */
const publicModel = (thinking: boolean): string => (thinking ? "dream-thinking" : "dream");

app.post("/api/v1/chat", async (c) => {
  const requestId = c.get("requestId");
  const { user } = requireUser(c.req.header("authorization"));
  c.set("requestUser", user.username);
  const body = await readJsonBody(c);
  const parsed = parseChatRequest(body);
  let expandedMessages = parsed.messages;
  if (parsed.files.length > 0) {
    const expanded = expandFiles(user.id, parsed.files, parsed.messages);
    expandedMessages = expanded.messages as typeof parsed.messages;
  }
  let parsedWithFiles = { ...parsed, messages: expandedMessages };

  if (config.mock) {
    console.log(
      `[dream-server] ${requestId} mock chat: ${parsed.messages.length} messages, thinking=${parsed.thinking}`,
    );
    const stream = mockChatStream(parsed.messages, parsed.thinking, {
      requestId,
      model: "dream-mock",
      thinking: parsed.thinking,
    });
    return new Response(stream, { headers: sseHeaders(requestId) });
  }

  let effective = parsedWithFiles;
  if (needsCompression(parsedWithFiles.messages)) {
    const startedAt = Date.now();
    const compressed = await compressContext(parsedWithFiles.messages, {
      onUsage: (usage: TokenUsage | null, keyId: number) =>
        recordUsage({
          userId: user.id,
          username: user.username,
          keyId,
          model: config.model,
          kind: "summary",
          usage,
        }),
    });
    effective = { ...parsedWithFiles, messages: compressed.messages };
    console.log(
      `[dream-server] ${requestId} context compressed: ${compressed.originalMessages} -> ${compressed.messages.length} messages, ${compressed.segments} segments (${compressed.cached} cached) in ${Date.now() - startedAt}ms`,
    );
  }

  console.log(
    `[dream-server] ${requestId} chat by ${user.username}: ${effective.messages.length} messages, thinking=${parsed.thinking}`,
  );
  if (effective.webSearch) {
    if (config.provider !== "qwen") {
      throw new ApiError(400, "INVALID_ARGUMENT", "联网搜索仅支持当前 Qwen 供应商");
    }
    console.log(`[dream-server] ${requestId} web search by ${user.username}: ${effective.messages.length} messages`);
    const searchStreamResult = await openSearchStream(
      effective.messages,
      { requestId, model: "dream-search", thinking: parsed.thinking },
      c.req.raw.signal,
      ({ usage, keyId }) => {
        recordUsage({
          userId: user.id,
          username: user.username,
          keyId,
          model: config.model,
          kind: "chat",
          usage,
        });
      },
    );
    return new Response(searchStreamResult, { headers: sseHeaders(requestId) });
  }

  let opened;
  try {
    opened = await openChatStream(effective, c.req.raw.signal);
  } catch (error) {
    if (error instanceof ApiError && error.code === "CONTENT_FILTERED") {
      // 与 DeepSeek 客户端一致：内容安全拒绝不报错，返回固定拒绝答复。
      recordModeration({
        userId: user.id,
        username: user.username,
        requestId,
        provider: config.provider,
        model: config.provider === "qwen" ? config.model : parsed.thinking ? config.reasonerModel : config.model,
        stage: "primary",
        messageCount: effective.messages.length,
        detail: error.message,
      });
      console.log(`[dream-server] ${requestId} content refused by ${config.providerLabel}`);
      return new Response(refusalStream({ requestId, model: publicModel(parsed.thinking), thinking: parsed.thinking }), {
        headers: sseHeaders(requestId),
      });
    }
    throw error;
  }
  const { stream: upstream, keyId, model: effectiveModel } = opened;
  const stream = dreamChatStream(
    upstream,
    {
      requestId,
      model: publicModel(parsed.thinking),
      thinking: parsed.thinking,
    },
    c.req.raw.signal,
    ({ usage }) => {
      recordUsage({
        userId: user.id,
        username: user.username,
        keyId,
        model: effectiveModel,
        kind: "chat",
        usage,
      });
    },
  );
  return new Response(stream, { headers: sseHeaders(requestId) });
});

// 安装包下载（放在静态资源之前，避免被 SPA 回退吞掉）。
const DOWNLOAD_FILES: Record<string, { file: string; type: string; name: string }> = {
  "dream-android.apk": {
    file: resolve(config.downloadDir, "dream-android.apk"),
    type: "application/vnd.android.package-archive",
    name: "Dream-Android.apk",
  },
};

app.get("/download/:file", (c) => {
  const entry = DOWNLOAD_FILES[c.req.param("file")];
  if (!entry || !existsSync(entry.file)) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND" as const,
          message: "安装包不存在",
          requestId: c.get("requestId") ?? "req_unknown",
        },
      },
      404,
    );
  }
  const stat = statSync(entry.file);
  c.header("content-type", entry.type);
  c.header("content-length", String(stat.size));
  c.header("content-disposition", `attachment; filename="${entry.name}"`);
  c.header("cache-control", "no-store");
  return c.body(Readable.toWeb(createReadStream(entry.file)) as unknown as ReadableStream);
});

// 同一进程托管 Web 静态文件（生产环境单端口 + 单隧道即可）。
app.use("/*", serveStatic({ root: config.webDir }));

app.get("*", (c, next) => {
  if (c.req.path.startsWith("/api/")) return next();
  return serveStatic({ path: `${config.webDir}/index.html` })(c, next);
});

app.notFound((c) => {
  const requestId = c.get("requestId") ?? "req_unknown";
  c.header("x-request-id", requestId);
  c.header("x-api-version", API_VERSION);
  return c.json(
    {
      error: {
        code: "NOT_FOUND" as const,
        message: "接口不存在",
        requestId,
      },
    },
    404,
  );
});

function isClientAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return (
    err.name === "AbortError" ||
    err.message === "aborted" ||
    code === "ECONNRESET" ||
    code === "ERR_STREAM_PREMATURE_CLOSE"
  );
}

function shouldRecordError(status: number, code: string): boolean {
  return (
    status >= 500 ||
    code === "CONTENT_FILTERED" ||
    code === "RATE_LIMITED" ||
    code.startsWith("UPSTREAM_")
  );
}

app.onError((err, c) => {
  const requestId = c.get("requestId") ?? "req_unknown";
  const username = c.get("requestUser") ?? null;
  const method = c.req.method;
  const path = c.req.path;

  // 客户端在上传请求体/等待响应时断开（手机切网、用户点停止）不是服务端错误。
  if (isClientAbort(err)) {
    console.info(`[dream-server] ${requestId} client aborted ${method} ${path}`);
    c.header("x-request-id", requestId);
    c.header("x-api-version", API_VERSION);
    return c.json(
      errorBody(new ApiError(499, "REQUEST_ABORTED", "客户端已断开连接"), requestId),
      499 as ContentfulStatusCode,
    );
  }

  if (err instanceof ApiError) {
    if (err.status >= 500 || err.code === "CONTENT_FILTERED") {
      console.warn(`[dream-server] ${requestId} ${err.status} ${err.code}: ${err.message}`);
    }
    pushLog({
      level: err.status >= 500 ? "error" : "warn",
      requestId,
      method,
      path,
      status: err.status,
      durationMs: 0,
      username: username ?? undefined,
      message: `${err.code}: ${err.message}`,
    });
    if (shouldRecordError(err.status, err.code)) {
      recordError({
        requestId,
        method,
        path,
        status: err.status,
        code: err.code,
        message: err.message,
        username,
      });
    }
    c.header("x-request-id", requestId);
    c.header("x-api-version", API_VERSION);
    return c.json(errorBody(err, requestId), err.status as ContentfulStatusCode);
  }

  console.error(`[dream-server] ${requestId}`, err);
  pushLog({
    level: "error",
    requestId,
    method,
    path,
    status: 500,
    durationMs: 0,
    username: username ?? undefined,
    message: err instanceof Error ? err.message : String(err),
  });
  recordError({
    requestId,
    method,
    path,
    status: 500,
    code: "INTERNAL",
    message: err instanceof Error ? err.message : String(err),
    username,
  });
  return c.json(
    {
      error: {
        code: "INTERNAL" as const,
        message: "服务端内部错误",
        requestId,
      },
    },
    500,
  );
});

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[dream-server] listening on http://${config.host}:${info.port}`);
  if (config.mock) {
    console.log("[dream-server] DREAM_MOCK=1，使用本地模拟流式响应（不会请求上游）");
  } else if (!config.apiKey) {
    console.warn(`[dream-server] 未配置 ${config.keyEnv}，/api/v1/chat 将返回 503`);
  } else {
    console.log(
      `[dream-server] 供应商 ${config.providerLabel}，转发到 ${config.baseUrl}，模型 ${config.model}${
        config.provider === "deepseek" ? ` / ${config.reasonerModel}` : "（enable_thinking 切换）"
      }`,
    );
  }
});
