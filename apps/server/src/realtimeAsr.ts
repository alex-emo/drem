import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { config } from "./config.js";
import { asrKeyPool, cooldownForStatus, type PooledKey } from "./keys.js";
import { requireUser } from "./auth.js";
import { hitRateLimit } from "./rateLimit.js";
import { recordError } from "./usage.js";

const ASR_PATH = "/api/v1/asr/ws";
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_STREAM_MS = 90_000;
const FINISH_TIMEOUT_MS = 12_000;

type ClientMessage =
  | { type: "finish" }
  | { type: "cancel" };

const send = (ws: WebSocket, payload: unknown) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
};

const tokenFromProtocols = (header: string | undefined): string | null => {
  const parts = (header ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const token = parts.find((part) => part !== "dream.asr" && part.length >= 20);
  return token ?? null;
};

const clientIpFromHeaders = (req: IncomingMessage): string => {
  const raw = req.headers["cf-connecting-ip"] ?? req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.split(",")[0]?.trim() || "unknown";
};

const upstreamUrl = (): string => {
  const base = config.asr.realtimeUrl;
  return base;
};

const runTaskPayload = (taskId: string) => ({
  header: { action: "run-task", task_id: taskId, streaming: "duplex" },
  payload: {
    task_group: "audio",
    task: "asr",
    function: "recognition",
    model: config.asr.realtimeModel,
    parameters: {
      format: "pcm",
      sample_rate: 16_000,
      language_hints: ["zh", "en"],
      semantic_punctuation_enabled: false,
      max_sentence_silence: 800,
      punctuation_prediction_enabled: true,
      inverse_text_normalization_enabled: true,
      heartbeat: true,
    },
    input: {},
  },
});

const finishPayload = (taskId: string) => ({
  header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
  payload: { input: {} },
});

/** 建立一次客户端 ↔ 上游的流式识别会话。 */
const startUpstream = (
  client: WebSocket,
  key: PooledKey,
): { upstream: WebSocket; taskId: string } => {
  const taskId = randomUUID();
  const upstream = new WebSocket(upstreamUrl(), {
    headers: {
      Authorization: `Bearer ${key.value}`,
      "X-DashScope-DataInspection": "enable",
    },
  });

  let ready = false;
  let finished = false;
  let audioBytes = 0;
  let finalText = "";
  const queued: Buffer[] = [];
  let finishTimer: NodeJS.Timeout | undefined;

  const cleanup = () => {
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = undefined;
  };
  const finish = (text: string) => {
    if (finished) return;
    finished = true;
    cleanup();
    send(client, { type: "final", text });
    try {
      client.close(1000, "done");
    } catch {
      // ignore
    }
  };

  upstream.on("open", () => {
    upstream.send(JSON.stringify(runTaskPayload(taskId)));
  });

  upstream.on("message", (data, isBinary) => {
    if (isBinary) return;
    let payload: any;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }
    const event = payload?.header?.event;
    if (event === "task-started") {
      ready = true;
      for (const chunk of queued) upstream.send(chunk);
      queued.length = 0;
      send(client, { type: "ready" });
      return;
    }
    if (event === "result-generated") {
      const sentence = payload?.payload?.output?.sentence;
      if (!sentence || sentence.heartbeat) return;
      const text = typeof sentence.text === "string" ? sentence.text : "";
      const isEnd = sentence.sentence_end === true;
      if (isEnd) {
        finalText += text;
        send(client, { type: "partial", text: finalText });
      } else {
        send(client, { type: "partial", text: finalText + text });
      }
      return;
    }
    if (event === "task-finished") {
      finish(finalText.trim());
      return;
    }
    if (event === "task-failed") {
      const detail = String(payload?.header?.error_message ?? "上游识别失败");
      asrKeyPool.markFailure(key, cooldownForStatus(502));
      recordError({
        status: 502,
        code: "ASR_UNAVAILABLE",
        message: detail.slice(0, 300),
        path: ASR_PATH,
        requestId: `ws_${randomUUID().slice(0, 12)}`,
        method: "WS",
      });
      send(client, { type: "error", message: "语音识别暂不可用，请稍后重试。" });
      finished = true;
      cleanup();
      try {
        client.close(1011, "upstream failed");
      } catch {
        // ignore
      }
      upstream.terminate();
    }
  });

  upstream.on("error", (error) => {
    asrKeyPool.markFailure(key, cooldownForStatus(502));
    recordError({
      status: 502,
      code: "ASR_UNAVAILABLE",
      message: (error as Error).message.slice(0, 300),
      path: ASR_PATH,
      requestId: `ws_${randomUUID().slice(0, 12)}`,
      method: "WS",
    });
    send(client, { type: "error", message: "语音识别连接失败，请稍后重试。" });
    finished = true;
    cleanup();
    try {
      client.close(1011, "upstream error");
    } catch {
      // ignore
    }
  });

  client.on("message", (data, isBinary) => {
    if (isBinary) {
      if (finished) return;
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      audioBytes += buffer.byteLength;
      if (audioBytes > MAX_AUDIO_BYTES) {
        send(client, { type: "error", message: "说话时间过长，请缩短后重试。" });
        finished = true;
        cleanup();
        upstream.terminate();
        client.close(1009, "too large");
        return;
      }
      if (ready) {
        upstream.send(buffer);
      } else {
        queued.push(buffer);
      }
      return;
    }
    let message: ClientMessage | null = null;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (message?.type === "finish" && !finished) {
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = setTimeout(() => finish(finalText.trim()), FINISH_TIMEOUT_MS);
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify(finishPayload(taskId)));
      }
    }
    if (message?.type === "cancel") {
      finished = true;
      cleanup();
      upstream.terminate();
      client.close(1000, "cancelled");
    }
  });

  client.on("close", () => {
    cleanup();
    try {
      upstream.terminate();
    } catch {
      // ignore
    }
  });

  const maxTimer = setTimeout(() => {
    if (!finished) {
      send(client, { type: "error", message: "录音时间过长，请重试。" });
      finished = true;
      cleanup();
      upstream.terminate();
      try {
        client.close(1009, "timeout");
      } catch {
        // ignore
      }
    }
  }, MAX_STREAM_MS);
  maxTimer.unref();

  return { upstream, taskId };
};

let installed = false;

/** 把 /api/v1/asr/ws 挂到现有 HTTP server 的 upgrade 事件上。 */
type UpgradeServer = {
  on: (
    event: "upgrade",
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ) => unknown;
};

export const attachRealtimeAsr = (server: UpgradeServer): void => {
  if (installed) return;
  installed = true;

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has("dream.asr") ? "dream.asr" : false),
  });

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== ASR_PATH) {
      socket.destroy();
      return;
    }

    const token = tokenFromProtocols(req.headers["sec-websocket-protocol"]);
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    try {
      requireUser(`Bearer ${token}`);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const retryAfter = hitRateLimit(clientIpFromHeaders(req), {
      name: "asr-ws",
      limit: config.rateLimit.asr,
      windowMs: 60_000,
      blockMs: 60_000,
    });
    if (retryAfter > 0) {
      socket.write(`HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${retryAfter}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket as Duplex, head, (client) => {
      const key = asrKeyPool.acquire();
      if (!key) {
        send(client, { type: "error", message: "语音识别暂不可用，请稍后重试。" });
        client.close(1013, "no key");
        return;
      }
      startUpstream(client, key);
    });
  });
};
