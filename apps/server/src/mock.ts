import type { ChatMessage } from "./deepseek.js";

const encoder = new TextEncoder();

function sse(delta: Record<string, unknown>): Uint8Array {
  return encoder.encode(
    `data: ${JSON.stringify({
      id: "dream-mock",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "dream-mock",
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text: string): string[] {
  return text.match(/[\s\S]{1,4}/g) ?? [];
}

/**
 * 本地模拟流：没有 API Key 时用于验证前端流式渲染 / Markdown / 思考过程 UI。
 * 输出格式与 OpenAI 兼容（含 reasoning_content），前端无需区分真假。
 */
export function mockStream(messages: ChatMessage[], thinking: boolean): ReadableStream<Uint8Array> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const reasoning = thinking
    ? "用户发来了消息。演示模式下我需要展示：思考过程、正文流式输出、Markdown 渲染。先给出说明，再放一段代码和表格。"
    : "";
  const answer = [
    "### 演示模式",
    "",
    "服务端还没有配置 `DEEPSEEK_API_KEY`，所以这条回复是**本地模拟**的，用来验证流式渲染链路是否通畅。",
    "",
    `你刚说的是：「${lastUser.trim().slice(0, 60)}」`,
    "",
    "- 消息经本地服务端以 SSE 转发",
    "- 回复内容按 token 逐个追加，前端实时渲染",
    "- 会话与消息保存在浏览器 IndexedDB 中",
    "",
    "```ts",
    'const res = await fetch("/api/chat", {',
    '  method: "POST",',
    '  body: JSON.stringify({ messages, thinking: false }),',
    "});",
    "```",
    "",
    "| 能力 | 状态 |",
    "| --- | --- |",
    "| 流式输出 | 已开启 |",
    "| 深度思考 | " + (thinking ? "已开启 |" : "未开启 |"),
    "| 真实模型 | 配置 Key 后可用 |",
    "",
    "在项目根目录的 `.env` 里填好 `DEEPSEEK_API_KEY` 并重启服务，即可获得真实回复。",
  ].join("\n");

  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (reasoning) {
          for (const piece of chunkText(reasoning)) {
            if (cancelled) return;
            controller.enqueue(sse({ reasoning_content: piece }));
            await sleep(16);
          }
        }
        for (const piece of chunkText(answer)) {
          if (cancelled) return;
          controller.enqueue(sse({ content: piece }));
          await sleep(18);
        }
        if (cancelled) return;
        controller.enqueue(sse({}));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
