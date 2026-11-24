import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_ENDPOINT,
  ChatApiError,
  fetchSharedChat,
  importArchiveFromUrl,
  loginAccount,
  registerAccount,
  streamChat,
  warmContext,
} from "@web/lib/api";
import { saveSession, clearSession } from "@web/lib/auth";

const encoder = new TextEncoder();

function sseResponse(blocks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

function baseOptions(overrides: Partial<Parameters<typeof streamChat>[0]> = {}) {
  return {
    messages: [{ role: "user" as const, content: "你好" }],
    thinking: false,
    signal: new AbortController().signal,
    onDelta: vi.fn(),
    onReasoning: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  clearSession();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatApiError", () => {
  it("输出十六进制错误码、文案与请求编号", () => {
    const error = new ChatApiError("内容过长", 413, "PAYLOAD_TOO_LARGE", "req_1", "0x1003");
    expect(error.message).toBe("0x1003 内容过长（请求编号 req_1）");
    expect(error).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE", hex: "0x1003", requestId: "req_1" });
  });

  it("未知 code 回退 0x5001", () => {
    expect(new ChatApiError("x", 0, "WHATEVER").hex).toBe("0x5001");
  });
});

describe("streamChat", () => {
  it("归一化 start/delta/thinking/sources/refusal/done 事件", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        event("start", { requestId: "req_1", model: "dream", thinking: true, createdAt: "t" }),
        event("thinking", { delta: "思考中" }),
        event("sources", { sources: [{ index: 1, title: "T", url: "https://x" }] }),
        event("delta", { delta: "你" }),
        event("delta", { delta: "好" }),
        event("done", { requestId: "req_1", finishReason: "stop", createdAt: "t" }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const options = baseOptions({
      thinking: true,
      onStart: vi.fn(),
      onSources: vi.fn(),
      onDone: vi.fn(),
      onRefusal: vi.fn(),
    });
    await streamChat(options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CHAT_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      messages: options.messages,
      thinking: true,
      files: undefined,
      webSearch: undefined,
    });
    expect(options.onStart).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req_1" }));
    expect(options.onReasoning).toHaveBeenCalledWith("思考中");
    expect(options.onSources).toHaveBeenCalledWith([{ index: 1, title: "T", url: "https://x" }]);
    expect(options.onDelta).toHaveBeenNthCalledWith(1, "你");
    expect(options.onDelta).toHaveBeenNthCalledWith(2, "好");
    expect(options.onDone).toHaveBeenCalledWith(expect.objectContaining({ finishReason: "stop" }));
    expect(options.onRefusal).not.toHaveBeenCalled();
  });

  it("refusal 事件转为正常回复文本", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      sseResponse([event("refusal", { message: "这个话题暂时无法回答。" }), event("done", { finishReason: "content_filter" })]),
    ));
    const options = baseOptions({ onRefusal: vi.fn() });
    await streamChat(options);
    expect(options.onRefusal).toHaveBeenCalledWith("这个话题暂时无法回答。");
  });

  it("error 事件抛出带 code/requestId 的 ChatApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      sseResponse([
        event("error", { error: { code: "UPSTREAM_ERROR", message: "模型服务暂时不可用", requestId: "req_9" } }),
      ]),
    ));
    await expect(streamChat(baseOptions())).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      requestId: "req_9",
    });
  });

  it("HTTP 错误解析服务端 errorBody", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "INVALID_ARGUMENT", hex: "0x1001", message: "请求内容不正确", requestId: "req_2" } }, 400),
    ));
    await expect(streamChat(baseOptions())).rejects.toMatchObject({
      status: 400,
      code: "INVALID_ARGUMENT",
      message: expect.stringContaining("0x1001 请求内容不正确（请求编号 req_2）"),
    });
  });

  it("非 SSE 响应报 INVALID_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    await expect(streamChat(baseOptions())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("网络异常应包装为 NETWORK 错误码", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(streamChat(baseOptions())).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("自动带上 Authorization 头", async () => {
    saveSession({ token: "tok_1", user: { id: "u1", username: "u", displayName: null, isAdmin: false, createdAt: "t" } } as never);
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([event("done", { finishReason: "stop" })]));
    vi.stubGlobal("fetch", fetchMock);
    await streamChat(baseOptions());
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer tok_1");
  });

  it("已收到部分输出后断网不再重试，直接抛出", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(event("delta", { delta: "部分" })));
          },
          // 第二帧才断流：error() 会丢弃队列里的数据，直接同步 error 会让 delta 丢失
          pull(controller) {
            controller.error(new Error("socket hang up"));
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const options = baseOptions();
    await expect(streamChat(options)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(options.onDelta).toHaveBeenCalledWith("部分");
  });
});

describe("requestJson 封装", () => {
  it("注册成功返回 token 与用户", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ token: "t", user: { id: "u" } }, 201)));
    const result = await registerAccount({ username: "abc", password: "password123" });
    expect(result.token).toBe("t");
  });

  it("登录失败抛出服务端错误文案", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "INVALID_CREDENTIALS", hex: "0x2002", message: "用户名或密码不正确", requestId: "r" } }, 401),
    ));
    await expect(loginAccount({ username: "abc", password: "x" })).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
  });

  it("响应不是 JSON 时用 HTTP 状态兜底", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 502 })));
    await expect(loginAccount({ username: "abc", password: "x" })).rejects.toMatchObject({
      status: 502,
      code: "HTTP_ERROR",
    });
  });
});

describe("importArchiveFromUrl", () => {
  it("按 NDJSON 分批回调会话与消息并返回统计", async () => {
    const lines = [
      { type: "conversation", conversation: { id: "c1", title: "T", createdAt: 1, updatedAt: 2 } },
      { type: "messages", messages: [{ id: "m1", content: "hi" }] },
      { type: "done", stats: { conversations: 1, messages: 1, skippedConversations: 0, skippedMessages: 0, attachments: 2 } },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join("");
    const response = new Response(encoder.encode(lines), {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const onConversation = vi.fn();
    const onMessages = vi.fn();
    const onProgress = vi.fn();
    const result = await importArchiveFromUrl("https://x.myhuaweicloud.com/a.zip", [], {
      onConversation,
      onMessages,
      onProgress,
    });
    expect(onConversation).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    expect(onMessages).toHaveBeenCalledWith([expect.objectContaining({ id: "m1" })]);
    expect(onProgress).toHaveBeenCalledWith({ conversations: 1, messages: 1 });
    expect(result).toMatchObject({ conversations: 1, messages: 1, attachments: 2 });
  });

  it("流内 error 事件抛 ChatApiError", async () => {
    const body = `${JSON.stringify({ type: "error", code: "INVALID_ARGUMENT", hex: "0x1001", message: "链接格式不正确" })}\n`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(encoder.encode(body), { status: 200, headers: { "content-type": "application/x-ndjson" } }),
    ));
    // 导入接口把流内 error 一律包装成 IMPORT_FAILED，但保留服务端文案（含 hex 与请求编号）
    await expect(importArchiveFromUrl("https://x", [])).rejects.toMatchObject({ code: "IMPORT_FAILED" });
  });

  it("HTTP 错误抛出 IMPORT_FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "INVALID_ARGUMENT", hex: "0x1001", message: "只支持 https 链接。", requestId: "r" } }, 400),
    ));
    await expect(importArchiveFromUrl("http://x", [])).rejects.toMatchObject({
      status: 400,
      code: "IMPORT_FAILED",
      message: expect.stringContaining("0x1001"),
    });
  });
});

describe("其他接口", () => {
  it("warmContext 失败抛 WARM_FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(warmContext([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "WARM_FAILED" });
  });

  it("fetchSharedChat 透传 url 参数", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ shareId: "s", title: "t", messages: [], attachments: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchSharedChat("https://chat.deepseek.com/share/abc");
    expect(result.shareId).toBe("s");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/v1/import/share?url=${encodeURIComponent("https://chat.deepseek.com/share/abc")}`,
    );
  });
});
