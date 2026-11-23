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

// 语音识别固定使用 Qwen/DashScope Key；聊天供应商为 DeepSeek 时也允许单独配置 ASR Key。
const qwenKeys = splitKeys(process.env.QWEN_API_KEY, process.env.QWEN_API_KEYS);
const asrKeys = splitKeys(
  process.env.DREAM_ASR_API_KEY,
  process.env.DREAM_ASR_API_KEYS,
  qwenKeys.join(","),
);
const qwenBaseUrl = (
  process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"
).replace(/\/+$/, "");

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
  appVersion: process.env.DREAM_APP_VERSION ?? "1.7.6",
  appVersionCode: Number(process.env.DREAM_APP_VERSION_CODE ?? 29),
  backupDir: process.env.DREAM_BACKUP_DIR ?? "data/backups",
  host: process.env.DREAM_HOST ?? "127.0.0.1",
  // 对外公开基址，用于生成 apkUrl；不能从请求 Host 头推导，避免 Host 头污染。
  publicOrigin: (process.env.DREAM_PUBLIC_ORIGIN ?? "https://dream.pum.org.cn").replace(/\/+$/, ""),
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
  asrKeys,
  // 语音识别独立配置；默认复用 Qwen/DashScope 兼容端点与 Key，不额外引入厂商 SDK。
  asr: {
    baseUrl: (process.env.DREAM_ASR_BASE_URL ?? qwenBaseUrl).replace(/\/+$/, ""),
    model: process.env.DREAM_ASR_MODEL ?? "qwen3-asr-flash",
    timeoutMs: Number(process.env.DREAM_ASR_TIMEOUT_MS ?? 30000),
  },
  mock: process.env.DREAM_MOCK === "1" || process.env.DREAM_MOCK === "true",
  dbPath: process.env.DREAM_DB_PATH ?? "data/dream.db",
  webDir: process.env.DREAM_WEB_DIR ?? "web",
  downloadDir: process.env.DREAM_DOWNLOAD_DIR ?? "downloads",
  adminUsers: splitList(process.env.DREAM_ADMIN_USERS),
  // 恶意高频/IP 注册限制。阈值刻意放宽，避免正常用户/共享 NAT 被误伤。
  rateLimit: {
    register: Number(process.env.DREAM_RL_REGISTER ?? 12), // 每 IP 每小时注册数
    login: Number(process.env.DREAM_RL_LOGIN ?? 60), // 每 IP 每 15 分钟登录尝试
    chat: Number(process.env.DREAM_RL_CHAT ?? 120), // 每 IP 每分钟聊天请求
    asr: Number(process.env.DREAM_RL_ASR ?? 30), // 每 IP 每分钟语音识别请求
    global: Number(process.env.DREAM_RL_GLOBAL ?? 1200), // 每 IP 每分钟全部 /api 请求
    archive: Number(process.env.DREAM_RL_ARCHIVE ?? 12), // 每 IP 每小时导入
  },
} as const;
