# 端到端测试（可选）

本目录放 Playwright 冒烟用例，**不包含在 `npm test` 里**：它需要额外安装 Playwright 与浏览器，
CI/本地按需执行。

```bash
npm i -D @playwright/test
npx playwright install chromium

# 自动拉起 `npm run dev`（服务端 mock 模式）
npx playwright test -c tests/e2e/playwright.config.ts

# 已手动启动前后端时，跳过 webServer
E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test -c tests/e2e/playwright.config.ts
```

约定：

- 选择器优先用 `getByRole` / `getByPlaceholder` 这类语义定位，避免依赖 CSS class；
- 每个用例自带数据（用户名带时间戳），不依赖其它用例的执行顺序；
- 端到端只验证"主流程能跑通"，边界与错误分支放在 `tests/unit`、`tests/integration`。
