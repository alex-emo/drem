import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { config } from "./config.js";
import {
  loginUser,
  logoutUser,
  registerUser,
  requireUser,
} from "./auth.js";
import { parseChatRequest, openChatStream } from "./deepseek.js";
import { fetchSharedChat } from "./share.js";
import { mockChatStream } from "./mock.js";
import {
  API_VERSION,
  ApiError,
  MAX_BODY_BYTES,
  SERVER_VERSION,
  errorBody,
  sseHeaders,
} from "./protocol.js";
import { dreamChatStream } from "./stream.js";

type AppEnv = { Variables: { requestId: string } };

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
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求体超过 1 MiB 上限");
  }

  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求体超过 1 MiB 上限");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_ARGUMENT", "请求体不是合法的 JSON");
  }
}

app.get("/api/v1/health", (c) => {
  const hasApiKey = Boolean(config.apiKey);
  return c.json({
    status: config.mock || !hasApiKey ? "degraded" : "ok",
    apiVersion: API_VERSION,
    serverVersion: SERVER_VERSION,
    serverTime: new Date().toISOString(),
    mock: config.mock,
    provider: config.provider,
    providerLabel: config.providerLabel,
    hasApiKey,
    models: {
      default: config.model,
      reasoner: config.reasonerModel,
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

app.get("/api/v1/import/share", async (c) => {
  requireUser(c.req.header("authorization"));
  const url = c.req.query("url") ?? "";
  return c.json(await fetchSharedChat(url));
});

app.post("/api/v1/chat", async (c) => {
  const requestId = c.get("requestId");
  const { user } = requireUser(c.req.header("authorization"));
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

  console.log(
    `[dream-server] ${requestId} chat by ${user.username}: ${parsed.messages.length} messages, thinking=${parsed.thinking}`,
  );
  const upstream = await openChatStream(parsed, c.req.raw.signal);
  const stream = dreamChatStream(
    upstream,
    {
      requestId,
      model:
        config.provider === "qwen" || !parsed.thinking ? config.model : config.reasonerModel,
      thinking: parsed.thinking,
    },
    c.req.raw.signal,
  );
  return new Response(stream, { headers: sseHeaders(requestId) });
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

app.onError((err, c) => {
  const requestId = c.get("requestId") ?? "req_unknown";

  if (err instanceof ApiError) {
    c.header("x-request-id", requestId);
    c.header("x-api-version", API_VERSION);
    return c.json(errorBody(err, requestId), err.status as ContentfulStatusCode);
  }

  console.error(`[dream-server] ${requestId}`, err);
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
