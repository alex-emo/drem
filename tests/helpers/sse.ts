/** 解析 Dream SSE 事件流为 { event, data } 列表。 */
export function parseSse(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim() || block.startsWith(":")) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) continue;
    events.push({ event, data: JSON.parse(dataLines.join("\n")) });
  }
  return events;
}

/** 用给定的 UTF-8 文本块构造一个 ReadableStream。 */
export function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** 把 Dream SSE 响应读成完整文本。 */
export async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** 构造上游 chat.completion.chunk 的 SSE 块。 */
export function upstreamChunk(payload: Record<string, unknown> | "[DONE]"): string {
  return `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
}
