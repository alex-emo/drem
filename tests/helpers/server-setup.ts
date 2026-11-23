import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 每个 worker 使用独立的临时 SQLite / 备份目录，且默认关闭真实上游。
 * 必须在 import 任何 server 模块之前设置，config.ts 在模块加载时读取 env。
 */
const dir = mkdtempSync(join(tmpdir(), "dream-test-"));
process.env.DREAM_MOCK = "1";
process.env.DREAM_DB_PATH = join(dir, "dream.db");
process.env.DREAM_BACKUP_DIR = join(dir, "backups");
process.env.DREAM_DOWNLOAD_DIR = join(dir, "downloads");
process.env.DREAM_WEB_DIR = join(dir, "web");
process.env.DREAM_ADMIN_USERS = "admin_test";
process.env.PORT = "0";
process.env.DREAM_PUBLIC_ORIGIN = "https://dream.test";
process.env.DEEPSEEK_API_KEY = "test-key";
delete process.env.QWEN_API_KEY;
delete process.env.QWEN_API_KEYS;
process.env.DREAM_PROVIDER = "deepseek";

export const testDirs = { root: dir };
