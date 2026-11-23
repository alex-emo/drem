import type { Message } from "./types";

/** 转换成上游消息；被内容安全拦截并从上下文移除的消息不参与后续请求。 */
export function historyFor(messages: Message[]) {
  return messages
    .filter((message) => !message.excludeFromContext)
    .filter(
      (message) =>
        message.role === "user" ||
        (message.role === "assistant" &&
          (message.status === "done" || message.status === "refused") &&
          message.content.trim().length > 0),
    )
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
}
