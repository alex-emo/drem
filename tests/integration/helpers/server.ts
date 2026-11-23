import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface TestServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

const repoRoot = resolve(__dirname, "../../..");

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // 服务还没起来
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`测试服务器在 ${timeoutMs}ms 内没有就绪：${baseUrl}`);
}

/**
 * 真实拉起 apps/server/src/index.ts 子进程（端口随机、临时 SQLite、mock 上游）。
 * 用子进程而不是 import，是因为 index.ts 末尾会直接 serve()。
 */
export async function startTestServer(extraEnv: Record<string, string> = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), "dream-it-"));
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    DREAM_MOCK: "1",
    DREAM_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "test-key",
    DREAM_DB_PATH: join(dir, "dream.db"),
    DREAM_BACKUP_DIR: join(dir, "backups"),
    DREAM_DOWNLOAD_DIR: join(dir, "downloads"),
    DREAM_WEB_DIR: join(dir, "web"),
    DREAM_ADMIN_USERS: "admin_test",
    DREAM_PUBLIC_ORIGIN: "https://dream.test",
    // 集成测试会连续注册/请求，放宽限流避免 429 干扰断言。
    DREAM_RL_REGISTER: "1000",
    DREAM_RL_LOGIN: "1000",
    DREAM_RL_CHAT: "1000",
    DREAM_RL_ASR: "1000",
    DREAM_RL_GLOBAL: "100000",
    DREAM_RL_ARCHIVE: "1000",
    PORT: String(port),
    HOST: "127.0.0.1",
    ...extraEnv,
  };

  const child: ChildProcess = spawn(resolve(repoRoot, "node_modules/.bin/tsx"), ["apps/server/src/index.ts"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill("SIGKILL");
    throw new Error(`${(error as Error).message}\n--- server output ---\n${output}`);
  }

  return {
    baseUrl,
    stop: () =>
      new Promise<void>((resolveStop) => {
        if (child.exitCode !== null) return resolveStop();
        child.once("exit", () => resolveStop());
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          resolveStop();
        }, 5_000).unref?.();
      }),
  };
}

let shared: Promise<TestServer> | null = null;

/** 整个测试文件共享一个服务器实例，减少启动开销。 */
export function sharedTestServer(): Promise<TestServer> {
  shared ??= startTestServer();
  return shared;
}

export async function stopSharedTestServer(): Promise<void> {
  if (!shared) return;
  const server = await shared;
  shared = null;
  await server.stop();
}
