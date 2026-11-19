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
  requireAdmin,
  requireUser,
} from "./auth.js";
import { parseChatRequest, openChatStream } from "./deepseek.js";
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

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Accept", "X-Request-Id", "Authorization"],
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

  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `请求体超过 ${MAX_BODY_MIB} MiB 上限`);
  }

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

  let effective = parsed;
  if (needsCompression(parsed.messages)) {
    const startedAt = Date.now();
    const compressed = await compressContext(parsed.messages, {
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
    effective = { ...parsed, messages: compressed.messages };
    console.log(
      `[dream-server] ${requestId} context compressed: ${compressed.originalMessages} -> ${compressed.messages.length} messages, ${compressed.segments} segments (${compressed.cached} cached) in ${Date.now() - startedAt}ms`,
    );
  }

  console.log(
    `[dream-server] ${requestId} chat by ${user.username}: ${effective.messages.length} messages, thinking=${parsed.thinking}`,
  );
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
  c.header("cache-control", "public, max-age=3600");
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

  if (err instanceof ApiError) {
    if (err.status >= 500 || err.code === "CONTENT_FILTERED") {
      console.warn(`[dream-server] ${requestId} ${err.status} ${err.code}: ${err.message}`);
    }
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
