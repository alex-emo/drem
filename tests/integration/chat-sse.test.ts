import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, registerTestUser } from "./helpers/api.js";
import { sharedTestServer, stopSharedTestServer, type TestServer } from "./helpers/server.js";

let server: TestServer;
let client: ApiClient;
let token: string;

beforeAll(async () => {
  server = await sharedTestServer();
  client = new ApiClient(server.baseUrl);
  token = (await registerTestUser(client, "chat")).token;
});

afterAll(async () => {
  await stopSharedTestServer();
});

interface SseEvent {
  event: string;
  data: any;
}

async function chatStream(
  body: unknown,
  options: { token?: string; abortAfterDeltas?: number } = {},
): Promise<{ status: number; headers: Headers; events: SseEvent[] }> {
  const controller = new AbortController();
  const response = await fetch(`${server.baseUrl}/api/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.token === undefined ? { authorization: `Bearer ${token}` } : { authorization: `Bearer ${options.token}` }),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    return { status: response.status, headers: response.headers, events: text ? [{ event: "raw", data: JSON.parse(text) }] : [] };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = "";
  let deltas = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      if (!block || block.startsWith(":")) continue;
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      if (dataLines.length === 0) continue;
      events.push({ event, data: JSON.parse(dataLines.join("\n")) });
      if (event === "delta") deltas += 1;
      if (options.abortAfterDeltas && deltas >= options.abortAfterDeltas) {
        controller.abort();
        return { status: response.status, headers: response.headers, events };
      }
    }
  }
  return { status: response.status, headers: response.headers, events };
}

describe("POST /api/v1/chat（mock 上游）", () => {
  it("返回 SSE 头并以 start → delta → done 输出", async () => {
    const result = await chatStream({ messages: [{ role: "user", content: "你好" }] });
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("text/event-stream");
    expect(result.headers.get("cache-control")).toContain("no-cache");
    expect(result.headers.get("x-api-version")).toBe("v1");
    const requestId = result.headers.get("x-request-id");
    expect(requestId).toBeTruthy();

    expect(result.events[0].event).toBe("start");
    expect(result.events[0].data).toMatchObject({ requestId, model: "dream-mock", thinking: false });
    const text = result.events
      .filter((event) => event.event === "delta")
      .map((event) => event.data.delta)
      .join("");
    expect(text).toContain("演示模式");
    const done = result.events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data).toMatchObject({ requestId, finishReason: "stop" });
  });

  it("thinking=true 时先输出 thinking 事件", async () => {
    const result = await chatStream(
      { messages: [{ role: "user", content: "思考一下" }], thinking: true },
      { abortAfterDeltas: 1 },
    );
    expect(result.events[0].data.thinking).toBe(true);
    const thinkingIndex = result.events.findIndex((event) => event.event === "thinking");
    const deltaIndex = result.events.findIndex((event) => event.event === "delta");
    expect(thinkingIndex).toBeGreaterThan(0);
    expect(deltaIndex).toBeGreaterThan(thinkingIndex);
  });

  it("未登录返回 401 JSON 错误", async () => {
    const response = await client.post("/api/v1/chat", { messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("请求体不合法返回 400，不会开始流", async () => {
    const response = await client.post("/api/v1/chat", { messages: [] }, { token });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("引用不存在的文件返回 404", async () => {
    const response = await client.post(
      "/api/v1/chat",
      { messages: [{ role: "user", content: "读文件" }], files: ["file_missing"] },
      { token },
    );
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("客户端断开后服务端不会崩溃（后续请求仍正常）", async () => {
    await chatStream({ messages: [{ role: "user", content: "断开测试" }] }, { abortAfterDeltas: 2 });
    const health = await client.get("/api/v1/health");
    expect(health.status).toBe(200);
  });
});

describe("POST /api/v1/context/warm", () => {
  it("短对话不压缩", async () => {
    const response = await client.post(
      "/api/v1/context/warm",
      { messages: [{ role: "user", content: "你好" }] },
      { token },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ compressed: false, segments: 0, originalMessages: 1 });
  });

  it("未登录返回 401", async () => {
    const response = await client.post("/api/v1/context/warm", { messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(401);
  });
});

describe("导入接口的参数校验", () => {
  it("分享链接格式错误返回 400", async () => {
    const response = await client.get("/api/v1/import/share?url=short", { token });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("归档导入只接受华为云 OBS 的 https 链接", async () => {
    for (const url of ["http://x.myhuaweicloud.com/a.zip", "https://evil.com/a.zip"]) {
      const response = await client.post("/api/v1/import/archive", { url }, { token });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_ARGUMENT");
    }
  });

  it("归档导入缺少 url 返回 400", async () => {
    const response = await client.post("/api/v1/import/archive", {}, { token });
    expect(response.status).toBe(400);
  });
});
