import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 极简 .env 读取：不覆盖已有环境变量，支持 # 注释与引号。 */
function loadDotenv(file: string): void {
  if (!existsSync(file)) return;
  const content = readFileSync(file, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// 支持项目根目录与 apps/server 下的 .env（根目录优先）
loadDotenv(resolve(process.cwd(), "../../.env"));
loadDotenv(resolve(process.cwd(), ".env"));

export type Provider = "deepseek" | "qwen";

const provider: Provider = process.env.DREAM_PROVIDER?.toLowerCase() === "qwen" ? "qwen" : "deepseek";

function splitKeys(...values: Array<string | undefined>): string[] {
  const keys: string[] = [];
  for (const value of values) {
    for (const part of (value ?? "").split(/[\s,]+/)) {
      const key = part.trim();
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

const apiKeys =
  provider === "qwen"
    ? splitKeys(process.env.QWEN_API_KEY, process.env.QWEN_API_KEYS)
    : splitKeys(process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_API_KEYS);

function splitList(...values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const part of (value ?? "").split(/[\s,]+/)) {
      const item = part.trim();
      if (item && !out.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
        out.push(item);
      }
    }
  }
  return out;
}

const model =
  provider === "qwen"
    ? (process.env.QWEN_MODEL ?? "qwen3.7-flash")
    : (process.env.DREAM_MODEL ?? "deepseek-chat");

export const config = {
  port: Number(process.env.PORT ?? 8787),
  appVersion: process.env.DREAM_APP_VERSION ?? "1.5.0",
  host: process.env.DREAM_HOST ?? "127.0.0.1",
  provider,
  providerLabel: provider === "qwen" ? "Qwen" : "DeepSeek",
  keyEnv: provider === "qwen" ? "QWEN_API_KEYS" : "DEEPSEEK_API_KEYS",
  apiKey: apiKeys[0] ?? "",
  apiKeys,
  baseUrl:
    provider === "qwen"
      ? (process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1")
      : (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, ""),
  model,
  // Qwen 用同一模型 ID + enable_thinking 切换；DeepSeek 用独立 reasoner 模型。
  reasonerModel:
    provider === "qwen" ? model : (process.env.DREAM_REASONER_MODEL ?? "deepseek-reasoner"),
  mock: process.env.DREAM_MOCK === "1" || process.env.DREAM_MOCK === "true",
  dbPath: process.env.DREAM_DB_PATH ?? "data/dream.db",
  webDir: process.env.DREAM_WEB_DIR ?? "web",
  downloadDir: process.env.DREAM_DOWNLOAD_DIR ?? "downloads",
  adminUsers: splitList(process.env.DREAM_ADMIN_USERS),
} as const;
