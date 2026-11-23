import { config } from "./config.js";
import {
  asrKeyPool,
  cooldownForStatus,
  isRetryableStatus,
  type PooledKey,
} from "./keys.js";
import { ApiError } from "./protocol.js";

/** 语音识别上传上限：与普通附件一致，保持 1 MiB（见 AGENTS §2.5）。 */
export const MAX_ASR_AUDIO_BYTES = 1 * 1024 * 1024;
/** 录音时长上限；16 kHz 单声道 16-bit PCM 下 1 MiB 约 32 秒，实际先命中体积上限。 */
export const MAX_ASR_AUDIO_SECONDS = 120;
/** 客户端录音格式固定为 16 kHz / 单声道 / 16-bit PCM。 */
export const ASR_SAMPLE_RATE = 16_000;
export const ASR_CHANNELS = 1;
export const ASR_BITS_PER_SAMPLE = 16;

export interface AsrAudioInfo {
  bytes: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
}

const invalidAudio = (reason: string): ApiError =>
  new ApiError(400, "ASR_AUDIO_INVALID", `录音格式无法识别（${reason}）`, [
    { field: "file", reason },
  ]);

const tooLarge = (reason: "size" | "duration", detail: string): ApiError =>
  new ApiError(413, "ASR_AUDIO_TOO_LARGE", detail, [{ field: "file", reason }]);

const readTag = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

/**
 * 解析并校验 WAV（RIFF）头。只接受浏览器录音直接产出的 16 kHz 单声道 16-bit PCM，
 * 避免把任意音频转发给上游，也让错误在本地就能定位。
 */
export function inspectWav(bytes: Uint8Array): AsrAudioInfo {
  if (bytes.byteLength > MAX_ASR_AUDIO_BYTES) {
    throw tooLarge("size", "录音文件超过 1 MiB 上限");
  }
  if (bytes.byteLength < 44 || readTag(bytes, 0) !== "RIFF" || readTag(bytes, 8) !== "WAVE") {
    throw invalidAudio("不是有效的 WAV 文件");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataBytes = -1;

  while (offset + 8 <= bytes.byteLength) {
    const id = readTag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.byteLength) {
      throw invalidAudio("WAV 数据不完整");
    }
    if (id === "fmt ") {
      if (size < 16) {
        throw invalidAudio("WAV 格式块损坏");
      }
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataBytes = size;
    }
    // RIFF 块按偶数字节对齐，奇数长度块后面有一个填充字节。
    offset = body + size + (size % 2);
  }

  if (!format) {
    throw invalidAudio("缺少 WAV 格式块");
  }
  if (dataBytes <= 0) {
    throw invalidAudio("WAV 没有音频数据");
  }
  if (format.audioFormat !== 1) {
    throw invalidAudio("只支持 PCM 编码");
  }
  if (format.channels !== ASR_CHANNELS) {
    throw invalidAudio("只支持单声道录音");
  }
  if (format.sampleRate !== ASR_SAMPLE_RATE) {
    throw invalidAudio("只支持 16 kHz 录音");
  }
  if (format.bitsPerSample !== ASR_BITS_PER_SAMPLE) {
    throw invalidAudio("只支持 16-bit 录音");
  }

  const durationSeconds = dataBytes / (format.sampleRate * format.channels * (format.bitsPerSample / 8));
  if (durationSeconds > MAX_ASR_AUDIO_SECONDS) {
    throw tooLarge("duration", `录音超过 ${MAX_ASR_AUDIO_SECONDS} 秒上限`);
  }
  return {
    bytes: bytes.byteLength,
    durationSeconds,
    sampleRate: format.sampleRate,
    channels: format.channels,
  };
}

/** 上游返回体只读取识别文本；厂商字段一律不进客户端响应。 */
export function extractAsrText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const message = (choices[0] as { message?: unknown } | null)?.message;
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  // 兼容部分兼容层返回 content 数组的写法。
  if (Array.isArray(content)) {
    const parts = content
      .map((part) =>
        typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean);
    return parts.length > 0 ? parts.join("") : null;
  }
  return null;
}

const asrEndpoint = (): string =>
  config.asr.baseUrl.endsWith("/chat/completions")
    ? config.asr.baseUrl
    : `${config.asr.baseUrl}/chat/completions`;

const buildPayload = (bytes: Uint8Array) => ({
  model: config.asr.model,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "input_audio",
          input_audio: {
            data: `data:audio/wav;base64,${Buffer.from(bytes).toString("base64")}`,
          },
        },
      ],
    },
  ],
  stream: false,
  asr_options: { enable_itn: true },
});

/** 上游超时与客户端取消分开处理：取消返回 499，上游慢返回 504。 */
async function fetchUpstream(
  key: PooledKey,
  bytes: Uint8Array,
  clientSignal: AbortSignal | undefined,
): Promise<{ ok: true; text: string } | { ok: false; status: number; detail: string }> {
  if (clientSignal?.aborted) {
    throw new ApiError(499, "REQUEST_ABORTED", "请求已取消");
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.asr.timeoutMs);
  const onClientAbort = () => controller.abort();
  clientSignal?.addEventListener("abort", onClientAbort, { once: true });

  try {
    const response = await fetch(asrEndpoint(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.value}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildPayload(bytes)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 600);
      return { ok: false, status: response.status, detail };
    }
    const raw = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return { ok: false, status: 502, detail: "上游返回的不是 JSON" };
    }
    const text = extractAsrText(payload);
    if (text === null) {
      return { ok: false, status: 502, detail: "上游响应缺少识别文本" };
    }
    return { ok: true, text };
  } catch (error) {
    if (clientSignal?.aborted) {
      throw new ApiError(499, "REQUEST_ABORTED", "请求已取消");
    }
    if (timedOut) {
      throw new ApiError(504, "UPSTREAM_TIMEOUT", "语音识别响应超时");
    }
    throw new ApiError(502, "ASR_UNAVAILABLE", `语音识别上游不可达：${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
    clientSignal?.removeEventListener("abort", onClientAbort);
  }
}

/**
 * 调用上游同步 ASR。使用现有 Qwen/DashScope Key（DREAM_ASR_API_KEY(S)，缺省回退 QWEN_*），
 * OpenAI 兼容协议 + Base64 Data URI，不需要公网音频 URL。
 */
export async function transcribeAudio(
  bytes: Uint8Array,
  clientSignal?: AbortSignal,
): Promise<string> {
  if (asrKeyPool.total === 0) {
    throw new ApiError(503, "ASR_NOT_CONFIGURED", "语音识别服务尚未配置");
  }

  const tried = new Set<number>();
  let lastError: ApiError | null = null;
  for (let attempt = 0; attempt < Math.max(1, asrKeyPool.total); attempt += 1) {
    const key = asrKeyPool.acquire(tried) ?? asrKeyPool.acquireIgnoringCooldown(tried);
    if (!key) break;
    tried.add(key.id);

    const result = await fetchUpstream(key, bytes, clientSignal);
    if (result.ok) {
      asrKeyPool.markSuccess(key);
      return result.text;
    }

    console.warn(`[dream-server] asr upstream status=${result.status}`);
    if (result.status === 400) {
      // 音频本身无法识别，换 Key 没有意义。
      throw new ApiError(400, "ASR_AUDIO_INVALID", `语音识别上游拒绝了音频：${result.detail}`);
    }
    if (result.status === 429) {
      asrKeyPool.markFailure(key, cooldownForStatus(result.status));
      lastError = new ApiError(429, "RATE_LIMITED", "语音识别请求过于频繁");
      continue;
    }
    if (isRetryableStatus(result.status)) {
      asrKeyPool.markFailure(key, cooldownForStatus(result.status));
      lastError = new ApiError(502, "ASR_UNAVAILABLE", `语音识别上游返回 ${result.status}：${result.detail}`);
      continue;
    }
    lastError = new ApiError(502, "ASR_UNAVAILABLE", `语音识别上游返回 ${result.status}：${result.detail}`);
  }

  throw lastError ?? new ApiError(502, "ASR_UNAVAILABLE", "没有可用的语音识别 Key");
}
