import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_ASR_AUDIO_BYTES } from "../../apps/server/src/asr.js";
import { ApiClient, registerTestUser } from "./helpers/api.js";
import { startTestServer, type TestServer } from "./helpers/server.js";

interface WavOptions {
  seconds?: number;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
}

function wav(options: WavOptions = {}): Uint8Array<ArrayBuffer> {
  const sampleRate = options.sampleRate ?? 16_000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const seconds = options.seconds ?? 1;
  const dataBytes = Math.round((seconds * sampleRate * channels * bitsPerSample) / 8);
  const arrayBuffer = new ArrayBuffer(44 + dataBytes);
  const buffer = Buffer.from(arrayBuffer);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
  buffer.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(arrayBuffer);
}

type MockMode = "ok" | "bad-request" | "slow";

interface MockRequest {
  authorization: string;
  body: string;
}

let upstream: Server;
let server: TestServer;
let client: ApiClient;
let token: string;
let upstreamBaseUrl = "";
let mode: MockMode = "ok";
const requests: MockRequest[] = [];

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      requests.push({ authorization: req.headers.authorization ?? "", body: raw });
      const send = (status: number, body: unknown) => {
        if (res.destroyed) return;
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      };
      if (mode === "bad-request") {
        send(400, { error: { message: "vendor-specific rejection" } });
        return;
      }
      if (mode === "slow") {
        setTimeout(() => send(200, { choices: [{ message: { content: "慢" } }] }), 1_500);
        return;
      }
      send(200, { choices: [{ message: { content: "你好，这是识别结果。" } }] });
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("mock upstream 端口获取失败");
  upstreamBaseUrl = `http://127.0.0.1:${address.port}/v1`;

  server = await startTestServer({
    DREAM_ASR_BASE_URL: upstreamBaseUrl,
    DREAM_ASR_API_KEY: "test-asr-key",
    DREAM_ASR_API_KEYS: "",
    DREAM_ASR_TIMEOUT_MS: "600",
    QWEN_API_KEY: "",
    QWEN_API_KEYS: "",
  });
  client = new ApiClient(server.baseUrl);
  token = (await registerTestUser(client, "asr")).token;
});

afterAll(async () => {
  await server?.stop();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe("POST /api/v1/tools/asr", () => {
  it("健康检查暴露语音识别已配置", async () => {
    const response = await client.get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body.features.speech).toBe(true);
  });

  it("未登录返回 401", async () => {
    const response = await client.request("POST", "/api/v1/tools/asr", {
      headers: { "content-type": "audio/wav" },
      rawBody: wav(),
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("非 WAV Content-Type 返回 415", async () => {
    const response = await client.request("POST", "/api/v1/tools/asr", {
      token,
      headers: { "content-type": "text/plain" },
      rawBody: "not audio",
    });
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("非法 WAV 返回 ASR_AUDIO_INVALID，且不会请求上游", async () => {
    const before = requests.length;
    const response = await client.request("POST", "/api/v1/tools/asr", {
      token,
      headers: { "content-type": "audio/wav" },
      rawBody: new Uint8Array(64),
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("ASR_AUDIO_INVALID");
    expect(response.body.error.hex).toBe("0x1006");
    expect(requests.length).toBe(before);
  });

  it("原始 WAV 成功识别，上游收到 base64 Data URI 与模型参数", async () => {
    const before = requests.length;
    const response = await client.request("POST", "/api/v1/tools/asr", {
      token,
      headers: { "content-type": "audio/wav" },
      rawBody: wav({ seconds: 1 }),
    });
    expect(response.status).toBe(200);
    expect(response.body.text).toBe("你好，这是识别结果。");
    expect(response.body.durationSeconds).toBe(1);
    expect(requests.length).toBe(before + 1);

    const upstreamRequest = requests.at(-1)!;
    expect(upstreamRequest.authorization).toBe("Bearer test-asr-key");
    const payload = JSON.parse(upstreamRequest.body) as {
      model: string;
      asr_options: { enable_itn: boolean };
      messages: Array<{ content: Array<{ input_audio: { data: string } }> }>;
    };
    expect(payload.model).toBe("qwen3-asr-flash");
    expect(payload.asr_options.enable_itn).toBe(true);
    expect(payload.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/wav;base64,/);
  });

  it("兼容 multipart 的 file 字段", async () => {
    const form = new FormData();
    form.append("file", new Blob([wav()], { type: "audio/wav" }), "recording.wav");
    const response = await client.request("POST", "/api/v1/tools/asr", {
      token,
      rawBody: form,
    });
    expect(response.status).toBe(200);
    expect(response.body.text).toBe("你好，这是识别结果。");
  });

  it("上游拒绝音频时返回固定错误目录，不泄漏厂商原文", async () => {
    mode = "bad-request";
    try {
      const response = await client.request("POST", "/api/v1/tools/asr", {
        token,
        headers: { "content-type": "audio/wav" },
        rawBody: wav(),
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("ASR_AUDIO_INVALID");
      expect(response.body.error.message).toBe("录音格式无法识别，请重新录制后重试。");
      expect(JSON.stringify(response.body)).not.toContain("vendor-specific");
    } finally {
      mode = "ok";
    }
  });

  it("上游超时返回 UPSTREAM_TIMEOUT", async () => {
    mode = "slow";
    try {
      const response = await client.request("POST", "/api/v1/tools/asr", {
        token,
        headers: { "content-type": "audio/wav" },
        rawBody: wav(),
      });
      expect(response.status).toBe(504);
      expect(response.body.error.code).toBe("UPSTREAM_TIMEOUT");
    } finally {
      mode = "ok";
    }
  });

  it("超过 1 MiB 返回 ASR_AUDIO_TOO_LARGE", async () => {
    const before = requests.length;
    const response = await client.request("POST", "/api/v1/tools/asr", {
      token,
      headers: { "content-type": "audio/wav" },
      rawBody: new Uint8Array(MAX_ASR_AUDIO_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("ASR_AUDIO_TOO_LARGE");
    expect(response.body.error.hex).toBe("0x1005");
    expect(requests.length).toBe(before);
  });
});

describe("未配置语音识别", () => {
  it("返回 ASR_NOT_CONFIGURED，客户端可展示明确提示", async () => {
    const unconfigured = await startTestServer({
      DREAM_ASR_API_KEY: "",
      DREAM_ASR_API_KEYS: "",
      QWEN_API_KEY: "",
      QWEN_API_KEYS: "",
    });
    try {
      const plainClient = new ApiClient(unconfigured.baseUrl);
      const health = await plainClient.get("/api/v1/health");
      expect(health.body.features.speech).toBe(false);

      const user = await registerTestUser(plainClient, "noasr");
      const response = await plainClient.request("POST", "/api/v1/tools/asr", {
        token: user.token,
        headers: { "content-type": "audio/wav" },
        rawBody: wav(),
      });
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("ASR_NOT_CONFIGURED");
      expect(response.body.error.hex).toBe("0x4006");
      expect(response.body.error.message).toContain("语音识别未配置");
    } finally {
      await unconfigured.stop();
    }
  });
});
