import { describe, expect, it } from "vitest";
import {
  API_VERSION,
  ApiError,
  ERROR_HEX_CODES,
  MAX_BODY_BYTES,
  MAX_BODY_MIB,
  REFUSAL_MESSAGE,
  USER_ERROR_MESSAGES,
  errorBody,
  errorHex,
  sseEncode,
  sseHeaders,
  userErrorMessage,
} from "../../../apps/server/src/protocol.js";

describe("protocol 常量", () => {
  it("版本与体积上限保持契约", () => {
    expect(API_VERSION).toBe("v1");
    expect(MAX_BODY_MIB).toBe(16);
    expect(MAX_BODY_BYTES).toBe(16 * 1024 * 1024);
    expect(REFUSAL_MESSAGE).toContain("暂时无法回答");
  });
});

describe("ApiError", () => {
  it("保留 status/code/details", () => {
    const error = new ApiError(400, "INVALID_ARGUMENT", "bad", [{ field: "messages", reason: "empty" }]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(400);
    expect(error.code).toBe("INVALID_ARGUMENT");
    expect(error.details).toEqual([{ field: "messages", reason: "empty" }]);
  });
});

describe("errorHex / userErrorMessage", () => {
  it("每个错误码都有十六进制码与中文文案", () => {
    for (const code of Object.keys(ERROR_HEX_CODES) as Array<keyof typeof ERROR_HEX_CODES>) {
      expect(errorHex(code)).toMatch(/^0x[0-9a-f]{4}$/);
      expect(userErrorMessage(code).length).toBeGreaterThan(0);
    }
  });

  it("未知错误码回退到 0x5001 / 内部错误文案", () => {
    expect(errorHex("NOPE" as never)).toBe("0x5001");
    expect(userErrorMessage("NOPE" as never)).toBe(USER_ERROR_MESSAGES.INTERNAL);
  });
});

describe("errorBody", () => {
  it("只输出目录中的固定文案，不泄漏原始 message", () => {
    const body = errorBody(new ApiError(401, "UNAUTHORIZED", "token 秘密失效"), "req_123");
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      hex: "0x2001",
      message: USER_ERROR_MESSAGES.UNAUTHORIZED,
      requestId: "req_123",
    });
    expect(JSON.stringify(body)).not.toContain("秘密");
  });

  it("details 非空时才输出", () => {
    const withDetails = errorBody(
      new ApiError(400, "INVALID_ARGUMENT", "x", [{ field: "thinking", reason: "type" }]),
      "req_1",
    );
    expect(withDetails.error.details).toEqual([{ field: "thinking", reason: "type" }]);
    const empty = errorBody(new ApiError(400, "INVALID_ARGUMENT", "x", []), "req_1");
    expect(empty.error).not.toHaveProperty("details");
  });
});

describe("SSE 编码", () => {
  it("按 event/data 双行加空行编码", () => {
    const bytes = sseEncode("delta", { delta: "你好" });
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(`event: delta\ndata: {"delta":"你好"}\n\n`);
  });

  it("headers 声明流式且禁用缓冲", () => {
    const headers = sseHeaders("req_abc");
    expect(headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(headers["cache-control"]).toContain("no-cache");
    expect(headers["x-accel-buffering"]).toBe("no");
    expect(headers["x-request-id"]).toBe("req_abc");
    expect(headers["x-api-version"]).toBe("v1");
  });
});
