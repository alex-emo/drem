import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export const MAX_FEEDBACK_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const dir = resolve(config.feedbackDir);

function ensureDir(): void {
  mkdirSync(dir, { recursive: true });
}

/** 保存截图，返回相对 feedbackDir 的文件名。 */
export function saveFeedbackScreenshot(bytes: Uint8Array, mime: string): string {
  const ext = ALLOWED_MIME[mime];
  if (!ext) {
    throw new Error("unsupported screenshot type");
  }
  ensureDir();
  const name = `${randomUUID()}${ext}`;
  writeFileSync(join(dir, name), bytes);
  return name;
}

export function readFeedbackScreenshot(name: string): Buffer | null {
  // 只接受本模块生成的文件名，避免路径穿越。
  if (!/^[a-f0-9-]+\.(png|jpg|webp)$/i.test(name)) return null;
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

export function feedbackScreenshotMime(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg")) return "image/jpeg";
  return "image/webp";
}

export function deleteFeedbackScreenshot(name: string | null): void {
  if (!name || !/^[a-f0-9-]+\.(png|jpg|webp)$/i.test(name)) return;
  try {
    unlinkSync(join(dir, name));
  } catch {
    // 文件已不在时忽略。
  }
}
