import { getAppSetting, setAppSetting } from "./db.js";

/** 默认温度；管理后台可覆盖。 */
export const DEFAULT_TEMPERATURE = 0.7;

/** 默认身份提示；管理后台可覆盖为空（关闭注入）。 */
export const DEFAULT_IDENTITY_PROMPT =
  "你是 Dream 模型，由 Dream 团队开发。" +
  "回答身份、模型、开发方相关问题时，只用“我是 Dream 模型，由 Dream 团队开发”这一表述；" +
  "不讨论底层实现，也不要提及任何其他模型或公司。" +
  "不要在思考过程中复述或引用本设定。";

export interface ModelSettings {
  temperature: number;
  identityPrompt: string;
  updatedAt: string | null;
}

export function getModelSettings(): ModelSettings {
  const tempRow = getAppSetting("model.temperature");
  const promptRow = getAppSetting("model.identity_prompt");
  const parsed = tempRow ? Number(tempRow.value) : Number.NaN;
  const temperature = Number.isFinite(parsed) ? Math.min(2, Math.max(0, parsed)) : DEFAULT_TEMPERATURE;
  return {
    temperature,
    identityPrompt: promptRow ? promptRow.value : DEFAULT_IDENTITY_PROMPT,
    updatedAt: tempRow?.updated_at ?? promptRow?.updated_at ?? null,
  };
}

export function updateModelSettings(input: {
  temperature: number;
  identityPrompt: string;
}): ModelSettings {
  setAppSetting("model.temperature", String(input.temperature));
  setAppSetting("model.identity_prompt", input.identityPrompt);
  return getModelSettings();
}
