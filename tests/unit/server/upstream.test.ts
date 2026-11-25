import { afterEach, describe, expect, it, vi } from "vitest";
import { openChatStream, parseChatRequest, requestUpstreamJson } from "../../../apps/server/src/deepseek.js";
import { getModel } from "../../../apps/server/src/models.js";
import { ApiError } from "../../../apps/server/src/protocol.js";

function parsed(overrides: Record<string, unknown> = {}) {
  return parseChatRequest({ messages: [{ role: "user", content: "你好" }], ...overrides });
}

function upstreamResponse(status: number, body: string, ok = status < 400): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

async function catchApiError(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("预期抛出 ApiError，但请求成功了");
}

/** 只检查状态码/错误码映射，不读流（失败时根本不会返回流）。 */
const open = (options: Record<string, unknown> = {}, signal = new AbortController().signal) =>
  openChatStream(parsed(options), signal, getModel("deepseek-chat"));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("上游错误映射", () => {
  it.each([
    [400, "This model's maximum context length is 65536 tokens", 413, "PAYLOAD_TOO_LARGE"],
    [400, "DataInspectionFailed: Input text data is risky", 422, "CONTENT_FILTERED"],
    [401, "invalid api key", 502, "UPSTREAM_AUTH_FAILED"],
    [403, "forbidden", 502, "UPSTREAM_AUTH_FAILED"],
    [402, "insufficient balance", 502, "UPSTREAM_ERROR"],
    [429, "rate limit reached", 429, "RATE_LIMITED"],
    [504, "gateway timeout", 504, "UPSTREAM_TIMEOUT"],
    [500, "internal error", 502, "UPSTREAM_ERROR"],
    [404, "not found", 502, "UPSTREAM_ERROR"],
  ])("上游 %i %s → %i/%s", async (status, detail, expectedStatus, code) => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamResponse(status, JSON.stringify({ error: { message: detail } })));
    vi.stubGlobal("fetch", fetchMock);

    const error = await catchApiError(() => open());
    expect(error).toMatchObject({ status: expectedStatus, code });
    // 原始上游文案不进入公开 message；对外文案由 protocol.ts 的错误目录统一生成
    expect(error.message).toContain("Dream");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("连接失败报 UPSTREAM_ERROR 且附带原因", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const error = await catchApiError(() => open());
    expect(error).toMatchObject({ status: 502, code: "UPSTREAM_ERROR" });
    expect(error.message).toContain("无法连接");
  });

  it("客户端已断开时不重试，直接 499", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await catchApiError(() => open({}, controller.signal));
    expect(error).toMatchObject({ status: 499, code: "REQUEST_ABORTED" });
  });

  it("上游 200 但没有响应体时报 UPSTREAM_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } })),
    );
    const error = await catchApiError(() => open());
    expect(error).toMatchObject({ status: 502, code: "UPSTREAM_ERROR" });
  });
});

describe("上游请求参数", () => {
  it("普通对话使用 chat 模型并带 temperature，注入 Dream 身份 system 消息", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await open();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/chat\/completions$/);
    expect(init.headers.authorization).toMatch(/^Bearer /);
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({ model: "deepseek-v4-pro", stream: true, stream_options: { include_usage: true } });
    expect(typeof payload.temperature).toBe("number");
    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages.at(-1)).toEqual({ role: "user", content: "你好" });
  });

  it("thinking=true 切到推理模型且不发送 temperature", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await open({ thinking: true });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.model).toBe("deepseek-v4-pro");
    expect(payload).not.toHaveProperty("temperature");
  });

  it("requestUpstreamJson 解析 usage 并返回所用 key 序号", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        upstreamResponse(200, JSON.stringify({ choices: [{ message: { content: "摘要" } }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })),
      ),
    );
    const result = await requestUpstreamJson({ model: "deepseek-chat", messages: [] });
    expect(result.keyId).toBeGreaterThan(0);
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 3, totalTokens: 15 });
    expect(result.data).toMatchObject({ choices: [{ message: { content: "摘要" } }] });
  });
});
