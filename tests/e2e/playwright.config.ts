import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端测试（可选）：需要先安装 Playwright 与浏览器。
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *   npx playwright test -c tests/e2e/playwright.config.ts
 *
 * 默认由 Playwright 拉起 `npm run dev`（服务端 mock 模式 + Vite），
 * 若本地已手动启动，可设置 E2E_BASE_URL 跳过 webServer。
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "zh-CN",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { DREAM_MOCK: "1", PORT: "8787" },
      },
});
