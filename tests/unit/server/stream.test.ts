import { describe, expect, it } from "vitest";
import { dreamChatStream, refusalStream } from "../../../apps/server/src/stream.js";
import { REFUSAL_MESSAGE } from "../../../apps/server/src/protocol.js";
import { parseSse, readStream, streamFromChunks, upstreamChunk } from "../../helpers/sse.js";

const meta = { requestId: "req_stream_test", model: "dream", thinking: false };

async function run(chunks: string[], options: { signal?: AbortSignal; thinking?: boolean } = {}) {
  const finished: Array<{ finishReason: string; usage: unknown }> = [];
  const stream = dreamChatStream(
    streamFromChunks(chunks),
    { ...meta, thinking: options.thinking ?? false },
    options.signal,
    (info) => finished.push(info),
  );
  const events = parseSse(await readStream(stream));
  return { events, finished };
}

describe("dreamChatStream 归一化", () => {
  it("先发 start，再逐字 delta，最后 done", async () => {
    const { events, finished } = await run([
      upstreamChunk({ choices: [{ delta: { content: "你好世界" } }] }),
      upstreamChunk({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      upstreamChunk("[DONE]"),
    ]);
    expect(events[0].event).toBe("start");
    expect(events[0].data).toMatchObject({ requestId: meta.requestId, model: "dream", thinking: false });
    const text = events
      .filter((event) => event.event === "delta")
      .map((event) => (event.data as { delta: string }).delta)
      .join("");
    expect(text).toBe("你好世界");
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data).toMatchObject({ requestId: meta.requestId, finishReason: "stop" });
    expect(finished).toEqual([{ finishReason: "stop", usage: null }]);
  });

  it("reasoning_content 走 thinking 事件并先于正文输出", async () => {
    const { events } = await run([
      upstreamChunk({ choices: [{ delta: { reasoning_content: "先想一想" } }] }),
      upstreamChunk({ choices: [{ delta: { content: "答案" } }] }),
      upstreamChunk("[DONE]"),
    ]);
    const thinking = events
      .filter((event) => event.event === "thinking")
      .map((event) => (event.data as { delta: string }).delta)
      .join("");
    expect(thinking).toBe("先想一想");
    expect(events.findIndex((event) => event.event === "thinking")).toBeLessThan(
      events.findIndex((event) => event.event === "delta"),
    );
  });

  it("finish_reason 映射：length / content_filter / 未知值", async () => {
    for (const [raw, expected] of [
      ["length", "length"],
      ["content_filter", "content_filter"],
      ["tool_calls", "unknown"],
    ] as const) {
      const { events } = await run([
        upstreamChunk({ choices: [{ delta: { content: "x" }, finish_reason: raw }] }),
        upstreamChunk("[DONE]"),
      ]);
      expect(events.at(-1)!.data).toMatchObject({ finishReason: expected });
    }
  });

  it("透传 usage 给 onFinish", async () => {
    const { finished } = await run([
      upstreamChunk({
        choices: [{ delta: { content: "x" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      upstreamChunk("[DONE]"),
    ]);
    expect(finished[0].usage).toMatchObject({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("上游非法 JSON 时发 error 事件而不是抛错", async () => {
    const { events, finished } = await run(["data: {not json}\n\n"]);
    const error = events.find((event) => event.event === "error");
    expect(error?.data).toMatchObject({ error: { code: "UPSTREAM_ERROR", requestId: meta.requestId } });
    expect(finished[0].finishReason).toBe("stop");
  });

  it("客户端 abort 后流关闭且不再输出", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = dreamChatStream(streamFromChunks([upstreamChunk("[DONE]")]), meta, controller.signal);
    const events = parseSse(await readStream(stream));
    expect(events).toEqual([]);
  });

  it("支持被拆分的多字节 UTF-8 与 CRLF", async () => {
    const payload = `event: x\r\ndata: ${JSON.stringify({ choices: [{ delta: { content: "你好" } }] })}\r\n\r\n`;
    const bytes = new TextEncoder().encode(payload);
    const cut = payload.indexOf("你好") + 1; // 切在汉字字节中间
    const stream = dreamChatStream(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, cut));
          controller.enqueue(bytes.slice(cut));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      meta,
    );
    const events = parseSse(await readStream(stream));
    const text = events
      .filter((event) => event.event === "delta")
      .map((event) => (event.data as { delta: string }).delta)
      .join("");
    expect(text).toBe("你好");
  });
});

describe("refusalStream", () => {
  it("start → refusal → done(content_filter)", async () => {
    const events = parseSse(await readStream(refusalStream({ ...meta, thinking: true })));
    expect(events.map((event) => event.event)).toEqual(["start", "refusal", "done"]);
    expect(events[1].data).toMatchObject({ message: REFUSAL_MESSAGE });
    expect(events[2].data).toMatchObject({ finishReason: "content_filter" });
  });
});
