import type { ChatMessage } from "./deepseek.js";
import { sseEncode } from "./protocol.js";
import type { ChatStreamMeta } from "./stream.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text: string): string[] {
  return text.match(/[\s\S]{1,4}/g) ?? [];
}

/**
 * 本地模拟流：没有 API Key 或 DREAM_MOCK=1 时使用。
 * 输出 Dream 协议事件（与真实链路完全一致），便于前端回归。
 */
export function mockChatStream(
  messages: ChatMessage[],
  thinking: boolean,
  meta: ChatStreamMeta,
): ReadableStream<Uint8Array> {
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const reasoning = thinking
    ? "用户发来了消息。演示模式下需要展示：思考过程、正文流式输出、Markdown 渲染。先说明当前是模拟模式，再放一段代码和表格。"
    : "";
  const answer = [
    "### 演示模式",
    "",
    "当前服务端运行在本地模拟模式（`DREAM_MOCK=1`，或没有配置 `DEEPSEEK_API_KEY`），这条回复不会请求 DeepSeek，也不消耗 Token。",
    "",
    `你刚说的是：「${lastUser.trim().slice(0, 60)}」`,
    "",
    "- 消息经本地服务端以 SSE 转发",
    "- 事件按 `start → delta/thinking → done` 归一化",
    "- 会话与消息保存在浏览器 IndexedDB 中",
    "",
    "```ts",
    'const response = await fetch("/api/v1/chat", {',
    '  method: "POST",',
    '  body: JSON.stringify({ messages, thinking: false }),',
    "});",
    "```",
    "",
    "| 能力 | 状态 |",
    "| --- | --- |",
    "| 流式输出 | 已开启 |",
    "| 深度思考 | " + (thinking ? "已开启 |" : "未开启 |"),
    "| 真实模型 | 配置 API Key 后可用 |",
    "",
    "在项目根目录 `.env` 填入 `DEEPSEEK_API_KEY` 并重启服务，即可获得真实回复。",
  ].join("\n");

  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (cancelled) return false;
        try {
          controller.enqueue(sseEncode(event, data));
          return true;
        } catch {
          cancelled = true;
          return false;
        }
      };

      send("start", {
        requestId: meta.requestId,
        model: meta.model,
        thinking: meta.thinking,
        createdAt: new Date().toISOString(),
      });

      try {
        for (const piece of chunkText(reasoning)) {
          if (cancelled) return;
          send("thinking", { delta: piece });
          await sleep(16);
        }
        for (const piece of chunkText(answer)) {
          if (cancelled) return;
          send("delta", { delta: piece });
          await sleep(18);
        }
        if (cancelled) return;
        send("done", {
          requestId: meta.requestId,
          finishReason: "stop",
          createdAt: new Date().toISOString(),
        });
        controller.close();
      } catch {
        // 下游已取消
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
