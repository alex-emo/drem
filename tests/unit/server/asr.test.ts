import { describe, expect, it } from "vitest";
import {
  MAX_ASR_AUDIO_BYTES,
  extractAsrText,
  inspectWav,
} from "../../../apps/server/src/asr.js";
import { ApiError } from "../../../apps/server/src/protocol.js";

interface WavOptions {
  seconds?: number;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  audioFormat?: number;
}

function wav(options: WavOptions = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 16_000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const seconds = options.seconds ?? 1;
  const dataBytes = Math.round((seconds * sampleRate * channels * bitsPerSample) / 8);
  const buffer = Buffer.alloc(44 + dataBytes);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(options.audioFormat ?? 1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(buffer);
}

function expectApiError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    return;
  }
  throw new Error(`预期抛出 ${code}`);
}

describe("inspectWav", () => {
  it("接受 16 kHz 单声道 16-bit PCM，并算出时长", () => {
    const info = inspectWav(wav({ seconds: 2 }));
    expect(info.sampleRate).toBe(16_000);
    expect(info.channels).toBe(1);
    expect(info.durationSeconds).toBeCloseTo(2, 3);
    expect(info.bytes).toBe(44 + 64_000);
  });

  it("拒绝非 WAV、非 PCM、多声道、错误采样率与错误位深", () => {
    expectApiError(() => inspectWav(new Uint8Array(64)), "ASR_AUDIO_INVALID");
    expectApiError(() => inspectWav(wav({ audioFormat: 3 })), "ASR_AUDIO_INVALID");
    expectApiError(() => inspectWav(wav({ channels: 2 })), "ASR_AUDIO_INVALID");
    expectApiError(() => inspectWav(wav({ sampleRate: 44_100 })), "ASR_AUDIO_INVALID");
    expectApiError(() => inspectWav(wav({ bitsPerSample: 8 })), "ASR_AUDIO_INVALID");
  });

  it("拒绝 data 声明长度超过实际内容的截断文件", () => {
    const bytes = wav({ seconds: 1 });
    const truncated = bytes.slice(0, bytes.byteLength - 100);
    expectApiError(() => inspectWav(truncated), "ASR_AUDIO_INVALID");
  });

  it("超过 1 MiB 直接按体积拒绝", () => {
    const oversized = new Uint8Array(MAX_ASR_AUDIO_BYTES + 1);
    expectApiError(() => inspectWav(oversized), "ASR_AUDIO_TOO_LARGE");
  });
});

describe("extractAsrText", () => {
  it("读取 OpenAI 兼容响应的 choices[0].message.content", () => {
    expect(
      extractAsrText({ choices: [{ message: { content: "你好，世界" } }] }),
    ).toBe("你好，世界");
  });

  it("兼容 content 为文本片段数组", () => {
    expect(
      extractAsrText({ choices: [{ message: { content: [{ text: "你" }, { text: "好" }] } }] }),
    ).toBe("你好");
  });

  it("缺少 choices/content 时返回 null", () => {
    expect(extractAsrText(null)).toBeNull();
    expect(extractAsrText({})).toBeNull();
    expect(extractAsrText({ choices: [] })).toBeNull();
    expect(extractAsrText({ choices: [{ message: {} }] })).toBeNull();
  });
});
