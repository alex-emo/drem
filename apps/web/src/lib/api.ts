export interface ApiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  messages: ApiChatMessage[];
  thinking: boolean;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onReasoning: (text: string) => void;
}

export class ChatApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
  }
}

interface ChatChunk {
  error?: { message?: string } | string;
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

/** 请求本地服务端，解析 SSE 流并回调正文 / 思考内容。 */
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { messages, thinking, signal, onDelta, onReasoning } = options;

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, thinking }),
    signal,
  });

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // 保留默认提示
    }
    throw new ChatApiError(message, response.status);
  }

  if (!response.body) {
    throw new ChatApiError("当前浏览器不支持流式响应", 0);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleBlock = (block: string): boolean => {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (dataLines.length === 0) return false;

    const payload = dataLines.join("\n").trim();
    if (!payload) return false;
    if (payload === "[DONE]") return true;

    let chunk: ChatChunk;
    try {
      chunk = JSON.parse(payload) as ChatChunk;
    } catch {
      return false;
    }

    if (chunk.error) {
      const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
      throw new ChatApiError(message ?? "生成失败，请稍后重试", 0);
    }

    const delta = chunk.choices?.[0]?.delta;
    if (delta?.reasoning_content) onReasoning(delta.reasoning_content);
    if (delta?.content) onDelta(delta.content);
    return false;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (handleBlock(block)) {
        await reader.cancel().catch(() => undefined);
        return;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) handleBlock(buffer.replace(/\r\n/g, "\n"));
}
