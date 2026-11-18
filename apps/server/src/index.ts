import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { config } from "./config.js";
import { ChatRequestError, parseChatRequest, proxyChatStream } from "./deepseek.js";
import { mockStream } from "./mock.js";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    mock: config.mock,
    model: config.model,
    hasKey: Boolean(config.apiKey),
  }),
);

app.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => null);

  let parsed;
  try {
    parsed = parseChatRequest(body);
  } catch (err) {
    const message = err instanceof ChatRequestError ? err.message : "请求体格式不正确";
    return c.json({ error: message }, 400);
  }

  const sseHeaders = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  } as const;

  if (config.mock) {
    console.log(`[dream-server] mock chat: ${parsed.messages.length} messages, thinking=${parsed.thinking}`);
    return new Response(mockStream(parsed.messages, parsed.thinking), { headers: sseHeaders });
  }

  if (!config.apiKey) {
    return c.json(
      {
        error:
          "服务端未配置 DEEPSEEK_API_KEY：请在项目根目录创建 .env（参考 .env.example）并重启服务；或设置 DREAM_MOCK=1 使用本地模拟。",
      },
      503,
    );
  }

  try {
    console.log(`[dream-server] chat: ${parsed.messages.length} messages, thinking=${parsed.thinking}`);
    const stream = await proxyChatStream(parsed, c.req.raw.signal);
    return new Response(stream, { headers: sseHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "上游请求失败";
    const status = err instanceof ChatRequestError ? err.status : 502;
    return c.json({ error: message }, status as ContentfulStatusCode);
  }
});

app.notFound((c) => c.json({ error: "Not Found" }, 404));

app.onError((err, c) => {
  console.error("[dream-server]", err);
  return c.json({ error: "服务端内部错误" }, 500);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[dream-server] listening on http://127.0.0.1:${info.port}`);
  if (config.mock) {
    console.log("[dream-server] DREAM_MOCK=1，使用本地模拟流式响应（不会请求 DeepSeek）");
  } else if (!config.apiKey) {
    console.warn("[dream-server] 未配置 DEEPSEEK_API_KEY，/api/chat 将返回 503");
  } else {
    console.log(`[dream-server] 转发到 ${config.baseUrl}，模型 ${config.model} / ${config.reasonerModel}`);
  }
});
