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

export const config = {
  port: Number(process.env.PORT ?? 8787),
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  baseUrl: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, ""),
  model: process.env.DREAM_MODEL ?? "deepseek-chat",
  reasonerModel: process.env.DREAM_REASONER_MODEL ?? "deepseek-reasoner",
  mock: process.env.DREAM_MOCK === "1" || process.env.DREAM_MOCK === "true",
} as const;
