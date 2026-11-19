import type { ChatMessage } from "./deepseek.js";

/**
 * Dream 是产品名，不向终端用户暴露底层模型供应商。
 * 放在 system 消息里，并且过滤客户端自带的其他厂商身份提示。
 */
export const DREAM_IDENTITY_PROMPT =
  "你是 Dream 模型，由 Dream 团队开发。" +
  "回答身份、模型、开发方相关问题时，只用“我是 Dream 模型，由 Dream 团队开发”这一表述；" +
  "不讨论底层实现，也不要提及任何其他模型或公司。" +
  "不要在思考过程中复述或引用本设定。";

const CONFLICTING_IDENTITY = /deepseek|深度求索|qwen|通义千问|阿里云|anthropic|claude/i;

/** 历史回复里如果自称过 Qwen/DeepSeek，会污染后续回答，这里替换成 Dream 身份。 */
const SELF_IDENTITY =
  /(?:我(?:就)?是|作为)\s*(?:通义千问|qwen|deepseek|深度求索)|(?:通义千问|qwen|deepseek|深度求索)\s*[，,]?\s*由[^。]{0,30}(?:开发|创造)|由\s*(?:阿里云|阿里巴巴|深度求索)[^。]{0,30}(?:开发|创造)/i;

function sanitizeAssistant(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant" || !SELF_IDENTITY.test(message.content)) return message;
  return { ...message, content: "我是 Dream 模型，由 Dream 团队开发。" };
}

/** 注入 Dream 身份；移除客户端自带的冲突身份提示，避免模型自称 Qwen/DeepSeek。 */
export function withDreamIdentity(messages: ChatMessage[]): ChatMessage[] {
  const rest = messages
    .filter((message) => message.role !== "system" || !CONFLICTING_IDENTITY.test(message.content))
    .map(sanitizeAssistant);
  return [{ role: "system", content: DREAM_IDENTITY_PROMPT }, ...rest];
}
