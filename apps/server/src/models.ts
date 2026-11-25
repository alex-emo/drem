import { config } from "./config.js";

export type ModelProvider = "qwen" | "deepseek";

export interface PriceTier {
  /** 输入 token 上限；null 表示无上限。 */
  upToInputTokens: number | null;
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface PeakPricing {
  /** 高峰价（元/百万 token）。 */
  peak: { inputPerMillion: number; outputPerMillion: number };
  /** 空闲价（元/百万 token）。 */
  offPeak: { inputPerMillion: number; outputPerMillion: number };
}

export interface CatalogModel {
  id: string;
  label: string;
  description: string;
  provider: ModelProvider;
  upstreamModel: string;
  /** 固定阶梯价；与 peakPricing 二选一。 */
  tiers?: PriceTier[];
  peakPricing?: PeakPricing;
}

/**
 * 对外只展示 Dream 侧的模型名；upstreamModel 只在服务端使用。
 *
 * 价格来源（2026-11-25 查询）：
 * - Qwen3.7：https://developer.aliyun.com/article/1774212
 *   flash 三档：0.2/0.8、0.6/2.4、1.2/4.8 元/百万 token；
 *   plus：≤256k 2/8，>256k 6/24。
 * - DeepSeek：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 *   flash：高峰 2/8、空闲 1/4；
 *   v4-pro：高峰 9/27、空闲 4.5/13.5。
 *
 * 这里按“未命中缓存”的正式价计算；缓存命中价更低，暂不在账单里折算。
 */
const MODEL_CATALOG: CatalogModel[] = [
  {
    id: "qwen3.7-flash",
    label: "3.7 Flash",
    description: "轻量快速，适合日常对话",
    provider: "qwen",
    upstreamModel:
      process.env.QWEN_MODEL_FLASH ?? process.env.QWEN_MODEL ?? "qwen3.7-flash",
    tiers: [
      { upToInputTokens: 32_000, inputPerMillion: 0.2, outputPerMillion: 0.8 },
      { upToInputTokens: 256_000, inputPerMillion: 0.6, outputPerMillion: 2.4 },
      { upToInputTokens: null, inputPerMillion: 1.2, outputPerMillion: 4.8 },
    ],
  },
  {
    id: "qwen3.7-pro",
    label: "3.7 Pro",
    description: "强推理，适合复杂任务",
    provider: "qwen",
    upstreamModel: process.env.QWEN_MODEL_PRO ?? "qwen3.7-plus",
    tiers: [
      { upToInputTokens: 256_000, inputPerMillion: 2, outputPerMillion: 8 },
      { upToInputTokens: null, inputPerMillion: 6, outputPerMillion: 24 },
    ],
  },
  {
    id: "deepseek-chat",
    label: "DS Chat",
    description: "DeepSeek 通用对话模型",
    provider: "deepseek",
    upstreamModel: process.env.DEEPSEEK_MODEL_CHAT ?? "deepseek-v4-pro",
    peakPricing: {
      peak: { inputPerMillion: 9, outputPerMillion: 27 },
      offPeak: { inputPerMillion: 4.5, outputPerMillion: 13.5 },
    },
  },
  {
    id: "deepseek-4.1-flash",
    label: "DS 4.1 Flash",
    description: "DeepSeek 4.1 轻量模型",
    provider: "deepseek",
    upstreamModel: process.env.DEEPSEEK_MODEL_FLASH ?? "deepseek-flash",
    peakPricing: {
      peak: { inputPerMillion: 2, outputPerMillion: 8 },
      offPeak: { inputPerMillion: 1, outputPerMillion: 4 },
    },
  },
];

export const DEFAULT_MODEL_ID = "qwen3.7-flash";

export function listModels(): CatalogModel[] {
  return MODEL_CATALOG.map((model) => ({ ...model }));
}

export function getModel(id: string | null | undefined): CatalogModel {
  const found = MODEL_CATALOG.find((model) => model.id === id);
  return found ?? MODEL_CATALOG[0]!;
}

export function isKnownModel(id: string): boolean {
  return MODEL_CATALOG.some((model) => model.id === id);
}

/** 北京时间工作日 9:00–12:00、14:00–18:00 为 DeepSeek 高峰时段。 */
export function isDeepSeekPeak(at = new Date()): boolean {
  // 使用 Intl 获取北京时间，避免依赖服务器时区；法定节假日暂未扣除。
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const workday = weekday !== "Sat" && weekday !== "Sun";
  if (!workday) return false;
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

function tierPrice(model: CatalogModel, promptTokens: number): { input: number; output: number } {
  if (model.tiers && model.tiers.length > 0) {
    const tier =
      model.tiers.find((item) => item.upToInputTokens === null || promptTokens <= item.upToInputTokens) ??
      model.tiers[model.tiers.length - 1]!;
    return { input: tier.inputPerMillion, output: tier.outputPerMillion };
  }
  if (model.peakPricing) {
    const price = isDeepSeekPeak() ? model.peakPricing.peak : model.peakPricing.offPeak;
    return { input: price.inputPerMillion, output: price.outputPerMillion };
  }
  return { input: 0, output: 0 };
}

/**
 * 费用以“微元”（1e-6 元）为单位：tokens × 元/百万 token = 微元。
 * 例如 1000 token、2 元/百万 token = 2000 微元 = 0.002 元。
 */
export function estimateCostMicros(
  model: CatalogModel,
  promptTokens: number,
  completionTokens: number,
  at = new Date(),
): number {
  const price = tierPrice(model, Math.max(0, promptTokens));
  // DeepSeek 的高峰/空闲判断已在 tierPrice 内完成；这里再取一次会跨时段，故直接用价格。
  void at;
  const cost = Math.max(0, promptTokens) * price.input + Math.max(0, completionTokens) * price.output;
  return Math.round(cost);
}

export function formatCny(costMicros: number): string {
  return `¥${(costMicros / 1_000_000).toFixed(4)}`;
}

export function providerBaseUrl(provider: ModelProvider): string {
  return provider === "qwen" ? config.qwenBaseUrl : config.deepseekBaseUrl;
}
