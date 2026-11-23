import { gunzipSync } from "node:zlib";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { config } from "./config.js";
import { keyPool, asrKeyPool } from "./keys.js";
import {
  COMPRESS_MESSAGE_THRESHOLD,
  COMPRESS_TOKEN_THRESHOLD,
  CONTEXT_TOKEN_LIMIT,
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
  adminSetUserVerified,
  requireAdmin,
  requireUser,
  getBackupKey,
  clearBackupLegacy,
} from "./auth.js";
import {
  countFeedbackForAdmin,
  createAnnouncement,
  createFeedbackReport,
  db,
  deleteAnnouncement,
  getFeedbackReport,
  latestAnnouncement,
  listAnnouncements,
  listFeedbackByUser,
  listFeedbackForAdmin,
  replyFeedbackReport,
  updateAnnouncement,
  type FeedbackReproducible,
  type FeedbackStatus,
} from "./db.js";
import {
  feedbackScreenshotMime,
  MAX_FEEDBACK_SCREENSHOT_BYTES,
  readFeedbackScreenshot,
  saveFeedbackScreenshot,
} from "./feedback.js";
import { parseChatRequest, openChatStream } from "./deepseek.js";
import { createTextFile, deleteUserFile, expandFiles, listUserFiles, MAX_FILE_BYTES } from "./files.js";
import { inspectWav, MAX_ASR_AUDIO_BYTES, transcribeAudio } from "./asr.js";
import { openSearchStream } from "./search.js";
import { fetchSharedChat } from "./share.js";
import { archiveStream, streamArchiveImport, validateArchiveUrl, ArchiveImportError } from "./archiveImport.js";
import { mockChatStream } from "./mock.js";
import { DEFAULT_IDENTITY_PROMPT, DEFAULT_TEMPERATURE, getModelSettings, updateModelSettings } from "./settings.js";
import {
  API_VERSION,
  ApiError,
  errorHex,
  userErrorMessage,
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
import { getRelease } from "./release.js";
import { MAX_BACKUP_BYTES, backupFilePath, deleteBackupFile, readBackupBytes, saveBackupStream } from "./backups.js"
import { enforceRateLimit, type LimitRule } from "./rateLimit.js";

type AppEnv = { Variables: { requestId: string; requestUser?: string } };

const app = new Hono<AppEnv>();

// multipart 无法在 Hono 内部增量解析；先用 bodyLimit 流式计数，避免 chunked 上传绕过 10MiB 上限。
const uploadBodyLimit = bodyLimit({
  maxSize: MAX_FILE_BYTES + 512 * 1024,
  onError: (c) =>
    c.json(
      errorBody(new ApiError(413, "PAYLOAD_TOO_LARGE", "文件超过 1 MiB 上限"), c.get("requestId") ?? ""),
      413,
    ),
});

// 反馈截图：限制 5 MiB，multipart 额外留 256 KiB 边界/表单开销。
const feedbackBodyLimit = bodyLimit({
  maxSize: MAX_FEEDBACK_SCREENSHOT_BYTES + 256 * 1024,
  onError: (c) =>
    c.json(
      errorBody(new ApiError(413, "PAYLOAD_TOO_LARGE", "截图超过 5 MiB 上限"), c.get("requestId") ?? ""),
      413,
    ),
});

// 录音请求体按字节流式限长；multipart 额外留 64 KiB 边界/表单开销，真实音频仍由 inspectWav 卡 1 MiB。
const asrBodyLimit = bodyLimit({
  maxSize: MAX_ASR_AUDIO_BYTES + 64 * 1024,
  onError: (c) =>
    c.json(
      errorBody(
        new ApiError(413, "ASR_AUDIO_TOO_LARGE", "录音文件超过 1 MiB 上限", [
          { field: "file", reason: "size" },
        ]),
        c.get("requestId") ?? "",
      ),
      413,
    ),
});

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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 全局 + 关键入口的 IP 限流；阈值刻意放宽，优先挡脚本化恶意请求。 */
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/v1/health") return next();

  const globalRule: LimitRule = {
    name: "global",
    limit: config.rateLimit.global,
    windowMs: MINUTE,
    blockMs: 5 * MINUTE,
  };
  const limited = enforceRateLimit(c, globalRule);
  if (limited) return limited;
  await next();
});

app.use("/api/v1/auth/register", async (c, next) => {
  const rule: LimitRule = {
    name: "register",
    limit: config.rateLimit.register,
    windowMs: HOUR,
    blockMs: HOUR,
  };
  const limited = enforceRateLimit(c, rule);
  if (limited) return limited;
  await next();
});

app.use("/api/v1/auth/login", async (c, next) => {
  const rule: LimitRule = {
    name: "login",
    limit: config.rateLimit.login,
    windowMs: 15 * MINUTE,
    blockMs: 15 * MINUTE,
  };
  const limited = enforceRateLimit(c, rule);
  if (limited) return limited;
  await next();
});

app.use("/api/v1/chat", async (c, next) => {
  const rule: LimitRule = {
    name: "chat",
    limit: config.rateLimit.chat,
    windowMs: MINUTE,
    blockMs: 10 * MINUTE,
  };
  const limited = enforceRateLimit(c, rule);
  if (limited) return limited;
  await next();
});

app.use("/api/v1/import/archive", async (c, next) => {
  const rule: LimitRule = {
    name: "archive",
    limit: config.rateLimit.archive,
    windowMs: HOUR,
    blockMs: HOUR,
  };
  const limited = enforceRateLimit(c, rule);
  if (limited) return limited;
  await next();
});

app.use("/api/v1/tools/asr", async (c, next) => {
  const rule: LimitRule = {
    name: "asr",
    limit: config.rateLimit.asr,
    windowMs: MINUTE,
    blockMs: 5 * MINUTE,
  };
  const limited = enforceRateLimit(c, rule);
  if (limited) return limited;
  await next();
});

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

  // 不能先 arrayBuffer() 再检查大小：chunked 请求没有 Content-Length，
  // 那样会把任意大的请求先读进内存。这里按流累计字节，超限立即取消读取。
  const reader = c.req.raw.body?.getReader();
  if (!reader) {
    throw new ApiError(400, "INVALID_ARGUMENT", "请求体为空");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", `请求体超过 ${MAX_BODY_MIB} MiB 上限`);
    }
    chunks.push(value);
  }

  let bytes = Buffer.concat(chunks, total);
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
      compressAfterTokens: COMPRESS_TOKEN_THRESHOLD,
      tokenLimit: CONTEXT_TOKEN_LIMIT,
    },
    features: {
      files: true,
      webSearch: config.provider === "qwen",
      speech: asrKeyPool.total > 0,
    },
  });
});

// 官方 chat-demo 的附件上传路径是 /anthropic/v1/files；移动 App 直接复用它的上传逻辑。
app.post("/anthropic/v1/files", uploadBodyLimit, async (c) => {
  const authorization = c.req.header("authorization") ?? `Bearer ${c.req.header("x-api-key") ?? ""}`;
  const { user } = requireUser(authorization);
  const declaredLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES + 512 * 1024) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "文件超过 1 MiB 上限");
  }
  const body = await c.req.parseBody();
  const entry = body["file"];
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
    throw new ApiError(400, "INVALID_ARGUMENT", "缺少 file 字段");
  }
  const created = await createTextFile(user.id, entry.name || "未命名文本", new Uint8Array(await entry.arrayBuffer()));
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

/** 语音识别：支持原始 WAV 字节，也兼容 multipart 的 file 字段；统一转成 base64 调上游。 */
app.post("/api/v1/tools/asr", asrBodyLimit, async (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  c.set("requestUser", user.username);

  const contentType = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  let bytes: Uint8Array;
  if (contentType === "multipart/form-data") {
    const body = await c.req.parseBody();
    const entry = body["file"];
    if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
      throw new ApiError(400, "ASR_AUDIO_INVALID", "缺少录音文件", [{ field: "file", reason: "missing" }]);
    }
    bytes = new Uint8Array(await entry.arrayBuffer());
  } else if (["audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream"].includes(contentType)) {
    bytes = new Uint8Array(await c.req.arrayBuffer());
  } else {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "语音识别只接受 WAV 音频");
  }

  const info = inspectWav(bytes);
  const text = await transcribeAudio(bytes, c.req.raw.signal);
  return c.json({
    text,
    durationSeconds: Math.round(info.durationSeconds * 100) / 100,
  });
});

app.post("/api/v1/files", uploadBodyLimit, async (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 512 * 1024) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "文件超过 1 MiB 上限");
  }
  const body = await c.req.parseBody();
  const entry = body["file"];
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
    throw new ApiError(400, "INVALID_ARGUMENT", "缺少 file 字段");
  }
  const bytes = new Uint8Array(await entry.arrayBuffer());
  return c.json(await createTextFile(user.id, entry.name || "未命名文本", bytes), 201);
});

app.delete("/api/v1/files/:id", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  if (!deleteUserFile(user.id, c.req.param("id"))) {
    throw new ApiError(404, "NOT_FOUND", "文件不存在");
  }
  return c.json({ ok: true });
});

const REPRODUCIBLE_VALUES: readonly FeedbackReproducible[] = ["always", "sometimes", "once", "unknown"];
const FEEDBACK_STATUS_VALUES: readonly FeedbackStatus[] = ["open", "replied", "closed"];

const formText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const feedbackPublic = (row: ReturnType<typeof getFeedbackReport>) => {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    platform: row.platform,
    os: row.os,
    osVersion: row.os_version,
    appVersion: row.app_version,
    description: row.description,
    reproducible: row.reproducible,
    hasScreenshot: Boolean(row.screenshot_path),
    adminReply: row.admin_reply,
    repliedBy: row.replied_by,
    repliedAt: row.replied_at,
    status: row.status,
    createdAt: row.created_at,
  };
};

app.post("/api/v1/feedback", feedbackBodyLimit, async (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const body = await c.req.parseBody();
  const platform = formText(body["platform"]);
  const os = formText(body["os"]).slice(0, 60);
  const osVersion = formText(body["osVersion"]).slice(0, 80);
  const appVersion = formText(body["appVersion"]).slice(0, 40);
  const description = formText(body["description"]);
  const reproducible = formText(body["reproducible"]) as FeedbackReproducible;

  if (platform !== "web" && platform !== "app") {
    throw new ApiError(400, "INVALID_ARGUMENT", "platform 必须为 web 或 app");
  }
  if (!os) throw new ApiError(400, "INVALID_ARGUMENT", "缺少操作系统");
  if (description.length < 5 || description.length > 4000) {
    throw new ApiError(400, "INVALID_ARGUMENT", "问题描述需为 5–4000 字");
  }
  if (!REPRODUCIBLE_VALUES.includes(reproducible)) {
    throw new ApiError(400, "INVALID_ARGUMENT", "reproducible 参数不正确");
  }

  let screenshotPath: string | null = null;
  let screenshotMime: string | null = null;
  const rawScreenshot = body["screenshot"];
  if (rawScreenshot && typeof rawScreenshot !== "string" && typeof rawScreenshot.arrayBuffer === "function") {
    const mime = rawScreenshot.type || "image/png";
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
      throw new ApiError(400, "INVALID_ARGUMENT", "截图只支持 PNG/JPEG/WebP");
    }
    if (rawScreenshot.size > MAX_FEEDBACK_SCREENSHOT_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "截图超过 5 MiB 上限");
    }
    const bytes = new Uint8Array(await rawScreenshot.arrayBuffer());
    screenshotPath = saveFeedbackScreenshot(bytes, mime);
    screenshotMime = mime;
  }

  const report = createFeedbackReport({
    userId: user.id,
    username: user.username,
    platform,
    os,
    osVersion,
    appVersion,
    description,
    reproducible,
    screenshotPath,
    screenshotMime,
  });
  return c.json({ report: feedbackPublic(report) }, 201);
});

app.get("/api/v1/feedback", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  return c.json({ reports: listFeedbackByUser(user.id).map(feedbackPublic) });
});

app.get("/api/v1/feedback/:id/screenshot", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const report = getFeedbackReport(Number(c.req.param("id")));
  if (!report || report.user_id !== user.id || !report.screenshot_path) {
    throw new ApiError(404, "NOT_FOUND", "截图不存在");
  }
  const bytes = readFeedbackScreenshot(report.screenshot_path);
  if (!bytes) throw new ApiError(404, "NOT_FOUND", "截图不存在");
  return new Response(bytes, {
    headers: {
      "content-type": report.screenshot_mime ?? feedbackScreenshotMime(report.screenshot_path),
      "cache-control": "private, no-store",
    },
  });
});

const releaseInfo = async (c: Context<AppEnv>) => {
  const release = await getRelease(config.publicOrigin);
  c.header("cache-control", "no-store, no-cache, must-revalidate");
  if (!release) {
    const requestId = c.get("requestId") ?? "";
    return c.json(errorBody(new ApiError(404, "NOT_FOUND", "安装包尚未上传"), requestId), 404);
  }
  return c.json(release);
};

app.get("/api/v1/version", (c) => releaseInfo(c));
app.get("/api/v1/release", (c) => releaseInfo(c));

app.get("/api/v1/announcement", (c) => {
  c.header("cache-control", "no-store, no-cache, must-revalidate");
  const row = latestAnnouncement();
  return c.json({
    announcement: row
      ? { id: row.id, title: row.title, body: row.body, updatedAt: row.updated_at }
      : null,
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
  return c.json(await registerUser(body), 201);
});

app.post("/api/v1/auth/login", async (c) => {
  const body = await readJsonBody(c);
  return c.json(await loginUser(body));
});

app.post("/api/v1/auth/logout", (c) => {
  logoutUser(c.req.header("authorization"));
  return c.json({ ok: true });
});

app.get("/api/v1/me", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  return c.json({ user });
});

type BackupRow = {
  payload?: string;
  updated_at?: string;
  size?: number;
  path?: string | null;
  iv?: string | null;
  encoding?: string | null;
};

function getBackupRow(userId: string): BackupRow | undefined {
  return db
    .prepare("SELECT payload, updated_at, size, path, iv, encoding FROM chat_backups WHERE user_id = ?")
    .get(userId) as BackupRow | undefined;
}

app.get("/api/v1/backup/meta", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const { key, legacyKey } = getBackupKey(user.id);
  const row = getBackupRow(user.id);
  return c.json({
    key,
    ...(legacyKey ? { legacyKey } : {}),
    backup:
      row?.path && row.size
        ? { size: row.size, updatedAt: row.updated_at, iv: row.iv, version: 2 }
        : row?.payload
          ? { size: row.size ?? row.payload.length, updatedAt: row.updated_at, legacy: true }
          : null,
  });
});

app.get("/api/v1/backup/stream", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const row = getBackupRow(user.id);
  if (!row?.path || !row.size) {
    throw new ApiError(404, "NOT_FOUND", "云端还没有流式备份");
  }
  return c.body(Readable.toWeb(createReadStream(row.path)) as unknown as ReadableStream, 200, {
    "content-type": "application/octet-stream",
    "content-length": String(row.size),
    "x-backup-iv": row.iv ?? "",
    "x-backup-encoding": row.encoding ?? "",
    "cache-control": "no-store",
  });
});

app.put("/api/v1/backup/stream", async (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/octet-stream")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "备份上传必须使用 application/octet-stream");
  }
  const iv = c.req.header("x-backup-iv") ?? "";
  let ivBytes: Buffer;
  try {
    ivBytes = Buffer.from(iv, "base64");
  } catch {
    ivBytes = Buffer.alloc(0);
  }
  if (ivBytes.byteLength !== 12) {
    throw new ApiError(400, "INVALID_ARGUMENT", "备份 IV 不正确");
  }
  const declared = Number(c.req.header("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BACKUP_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `云备份超过 ${MAX_BACKUP_BYTES / 1024 / 1024} MiB 上限`);
  }
  const saved = await saveBackupStream(user.id, c.req.raw.body, c.req.raw.signal);
  const previous = getBackupRow(user.id);
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_backups (user_id, payload, updated_at, size, path, iv, encoding)
     VALUES (?, '', ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       payload = '', updated_at = excluded.updated_at, size = excluded.size,
       path = excluded.path, iv = excluded.iv, encoding = excluded.encoding`,
  ).run(user.id, updatedAt, saved.size, backupFilePath(user.id), iv, c.req.header("x-backup-encoding") ?? "gzip");
  if (previous?.path && previous.path !== saved.path) deleteBackupFile(previous.path);
  clearBackupLegacy(user.id);
  return c.json({ ok: true, updatedAt, size: saved.size });
});

// 兼容旧客户端：仍可读取/写入 base64 payload；新客户端走 /backup/meta + /backup/stream。
app.get("/api/v1/backup", (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const { key, legacyKey } = getBackupKey(user.id);
  const row = getBackupRow(user.id);
  let payload = row?.payload ?? "";
  if (!payload && row?.path && row.iv) {
    try {
      payload = `dream1.${row.iv}.${readBackupBytes(row.path).toString("base64")}`;
    } catch {
      payload = "";
    }
  }
  return c.json({
    key,
    ...(legacyKey ? { legacyKey } : {}),
    backup: payload
      ? { payload, updatedAt: row?.updated_at, size: row?.size ?? payload.length }
      : null,
  });
});

app.put("/api/v1/backup", async (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const body = (await readJsonBody(c)) as { payload?: unknown; updatedAt?: unknown };
  const payload = typeof body.payload === "string" ? body.payload : "";
  if (!payload) throw new ApiError(400, "INVALID_ARGUMENT", "payload 不能为空");
  if (payload.length > MAX_BACKUP_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `备份内容超过 ${MAX_BACKUP_BYTES / 1024 / 1024} MiB 上限`);
  }
  const previous = getBackupRow(user.id);
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_backups (user_id, payload, updated_at, size, path, iv, encoding) VALUES (?, ?, ?, ?, NULL, NULL, NULL)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, size = excluded.size,
       path = NULL, iv = NULL, encoding = NULL`,
  ).run(user.id, payload, updatedAt, payload.length);
  deleteBackupFile(previous?.path);
  clearBackupLegacy(user.id);
  return c.json({ ok: true, updatedAt, size: payload.length });
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

app.get("/api/v1/admin/model-settings", (c) => {
  requireAdmin(c.req.header("authorization"));
  return c.json({ settings: getModelSettings(), defaults: { temperature: DEFAULT_TEMPERATURE, identityPrompt: DEFAULT_IDENTITY_PROMPT } });
});

app.put("/api/v1/admin/model-settings", async (c) => {
  requireAdmin(c.req.header("authorization"));
  const body = (await readJsonBody(c)) as { temperature?: unknown; identityPrompt?: unknown };
  const current = getModelSettings();
  if (body.temperature !== undefined && (typeof body.temperature !== "number" || !Number.isFinite(body.temperature))) {
    throw new ApiError(400, "INVALID_ARGUMENT", "temperature 必须是数字");
  }
  if (body.identityPrompt !== undefined && typeof body.identityPrompt !== "string") {
    throw new ApiError(400, "INVALID_ARGUMENT", "identityPrompt 必须是字符串");
  }
  const temperature = body.temperature === undefined ? current.temperature : Number(body.temperature);
  if (temperature < 0 || temperature > 2) {
    throw new ApiError(400, "INVALID_ARGUMENT", "temperature 必须在 0 到 2 之间");
  }
  const identityPrompt = body.identityPrompt === undefined ? current.identityPrompt : String(body.identityPrompt);
  if (identityPrompt.length > 4000) {
    throw new ApiError(400, "INVALID_ARGUMENT", "初始提示词不能超过 4000 字");
  }
  return c.json({ settings: updateModelSettings({ temperature, identityPrompt }) });
});

app.get("/api/v1/admin/announcements", (c) => {
  requireAdmin(c.req.header("authorization"));
  return c.json({ announcements: listAnnouncements() });
});

app.post("/api/v1/admin/announcements", async (c) => {
  requireAdmin(c.req.header("authorization"));
  const body = (await readJsonBody(c)) as { title?: unknown; body?: unknown; active?: unknown };
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!text) throw new ApiError(400, "INVALID_ARGUMENT", "公告内容不能为空");
  return c.json({ announcement: createAnnouncement(title, text, body.active !== false) }, 201);
});

app.patch("/api/v1/admin/announcements/:id", async (c) => {
  requireAdmin(c.req.header("authorization"));
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "INVALID_ARGUMENT", "无效的公告编号");
  const body = (await readJsonBody(c)) as { title?: unknown; body?: unknown; active?: unknown };
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!text) throw new ApiError(400, "INVALID_ARGUMENT", "公告内容不能为空");
  const updated = updateAnnouncement(id, title, text, body.active !== false);
  if (!updated) throw new ApiError(404, "NOT_FOUND", "公告不存在");
  return c.json({ announcement: updated });
});

app.delete("/api/v1/admin/announcements/:id", (c) => {
  requireAdmin(c.req.header("authorization"));
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "INVALID_ARGUMENT", "无效的公告编号");
  if (!deleteAnnouncement(id)) throw new ApiError(404, "NOT_FOUND", "公告不存在");
  return c.json({ ok: true });
});

app.get("/api/v1/admin/feedback", (c) => {
  requireAdmin(c.req.header("authorization"));
  const limit = Number(c.req.query("limit") ?? "50");
  const offset = Number(c.req.query("offset") ?? "0");
  return c.json({
    total: countFeedbackForAdmin(),
    reports: listFeedbackForAdmin(limit, offset).map(feedbackPublic),
  });
});

app.get("/api/v1/admin/feedback/:id/screenshot", (c) => {
  requireAdmin(c.req.header("authorization"));
  const report = getFeedbackReport(Number(c.req.param("id")));
  if (!report || !report.screenshot_path) throw new ApiError(404, "NOT_FOUND", "截图不存在");
  const bytes = readFeedbackScreenshot(report.screenshot_path);
  if (!bytes) throw new ApiError(404, "NOT_FOUND", "截图不存在");
  return new Response(bytes, {
    headers: {
      "content-type": report.screenshot_mime ?? feedbackScreenshotMime(report.screenshot_path),
      "cache-control": "private, no-store",
    },
  });
});

app.patch("/api/v1/admin/feedback/:id", async (c) => {
  const admin = requireAdmin(c.req.header("authorization"));
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "INVALID_ARGUMENT", "无效的反馈编号");
  const body = (await readJsonBody(c)) as { reply?: unknown; status?: unknown };
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  const status = typeof body.status === "string" ? (body.status as FeedbackStatus) : "replied";
  if (reply.length > 4000) throw new ApiError(400, "INVALID_ARGUMENT", "回复不能超过 4000 字");
  if (!FEEDBACK_STATUS_VALUES.includes(status)) {
    throw new ApiError(400, "INVALID_ARGUMENT", "status 参数不正确");
  }
  if (!reply && status === "replied") {
    throw new ApiError(400, "INVALID_ARGUMENT", "回复内容不能为空");
  }
  const updated = replyFeedbackReport(id, reply, admin.username, status);
  if (!updated) throw new ApiError(404, "NOT_FOUND", "反馈不存在");
  return c.json({ report: feedbackPublic(updated) });
});

app.patch("/api/v1/admin/users/:id", async (c) => {
  const admin = requireAdmin(c.req.header("authorization"));
  const id = c.req.param("id");
  const body = (await readJsonBody(c)) as { disabled?: unknown; verified?: unknown };
  if (typeof body.disabled !== "boolean" && typeof body.verified !== "boolean") {
    throw new ApiError(400, "INVALID_ARGUMENT", "disabled 或 verified 必须是布尔值");
  }
  if (body.disabled === true && id === admin.id) {
    throw new ApiError(400, "INVALID_ARGUMENT", "不能禁用当前登录的管理员账号");
  }
  const result =
    typeof body.disabled === "boolean"
      ? adminSetUserDisabled(id, body.disabled)
      : adminSetUserVerified(id, body.verified as boolean);
  return c.json(result);
});

app.post("/api/v1/admin/users/:id/password", async (c) => {
  requireAdmin(c.req.header("authorization"));
  const body = (await readJsonBody(c)) as { password?: unknown };
  if (typeof body.password !== "string") {
    throw new ApiError(400, "INVALID_ARGUMENT", "password 必须是字符串");
  }
  await adminResetPassword(c.req.param("id"), body.password);
  return c.json({ ok: true });
});

app.post("/api/v1/admin/users/:id/revoke", (c) => {
  requireAdmin(c.req.header("authorization"));
  adminRevokeSessions(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/api/v1/import/archive", async (c) => {
  const { user } = requireUser(c.req.header("authorization"));
  const body = (await readJsonBody(c)) as { url?: unknown; skipIds?: unknown };
  if (typeof body.url !== "string" || !body.url.trim()) {
    throw new ApiError(400, "INVALID_ARGUMENT", "缺少导出文件链接");
  }
  const url = validateArchiveUrl(body.url.trim());
  const skipIds = new Set(
    Array.isArray(body.skipIds) ? body.skipIds.filter((id): id is string => typeof id === "string") : [],
  );
  console.log(`[dream-server] archive import by ${user.username}: ${url.hostname}`);
  const { pass, write } = archiveStream();
  void (async () => {
    try {
      const stats = await streamArchiveImport({ url: url.toString(), skipIds, write, signal: c.req.raw.signal });
      await write({ type: "done", stats });
    } catch (error) {
      const status = error instanceof ArchiveImportError ? error.status : 500;
      const code = status === 413 ? "PAYLOAD_TOO_LARGE" : status === 400 ? "INVALID_ARGUMENT" : "INTERNAL";
      console.warn(`[dream-server] archive import failed: ${error instanceof Error ? error.message : String(error)}`);
      try {
        await write({
          type: "error",
          code,
          hex: errorHex(code),
          message: userErrorMessage(code),
          status,
        });
      } catch {
        // 客户端已断开时忽略
      }
    } finally {
      pass.end();
    }
  })();
  return c.body(Readable.toWeb(pass) as unknown as ReadableStream, 200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
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
      `[dream-server] ${requestId} context compressed: ${compressed.originalMessages} -> ${compressed.messages.length} messages, ~${compressed.estimatedTokens} tokens, ${compressed.segments} segments (${compressed.cached} cached, ${compressed.clippedMessages} clipped, summary ~${compressed.summaryTokens} tokens) in ${Date.now() - startedAt}ms`,
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
  return c.json(errorBody(new ApiError(404, "NOT_FOUND", "接口不存在"), requestId), 404);
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

  if (err instanceof ArchiveImportError) {
    const status = err.status === 413 ? 413 : 400;
    c.header("x-request-id", requestId);
    c.header("x-api-version", API_VERSION);
    return c.json(
      errorBody(new ApiError(status, status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_ARGUMENT", err.message), requestId),
      status as ContentfulStatusCode,
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
    // 原始错误只写日志与后台 error_events，便于按 requestId 排查；返回给客户端的仍是固定中文目录。
    console.warn(`[dream-server] ${requestId} ${err.code}: ${err.message}`);
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
