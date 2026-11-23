import type { ChatMessage } from "./deepseek.js";
import { getModelSettings } from "./settings.js";

/** 注入管理后台配置的身份提示；为空时不注入。不自动改写历史消息或正文。 */
export function withDreamIdentity(messages: ChatMessage[]): ChatMessage[] {
  const prompt = getModelSettings().identityPrompt.trim();
  if (!prompt) return messages;
  return [{ role: "system", content: prompt }, ...messages];
}
