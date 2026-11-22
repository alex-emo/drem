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

/** 注入 Dream 身份；不自动改写历史消息或正文，避免破坏代码与事实。 */
export function withDreamIdentity(messages: ChatMessage[]): ChatMessage[] {
  return [{ role: "system", content: DREAM_IDENTITY_PROMPT }, ...messages];
}
