import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * 两个测试工程：
 *  - server：Node 环境，直接 import apps/server/src 下的模块；tests/integration 会真正拉起 HTTP 服务。
 *  - web：jsdom 环境，测试 apps/web/src 下的工具函数、IndexedDB 与备份逻辑。
 * e2e（tests/e2e）不在 vitest 里跑，见 tests/e2e/README.md。
 */
export default defineConfig({
  test: {
    reporters: ["default"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["apps/server/src/**/*.ts", "apps/web/src/lib/**/*.ts"],
      exclude: [
        "apps/server/src/index.ts",
        "apps/server/src/mock.ts",
        "apps/web/src/lib/types.ts",
      ],
    },
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: ["tests/unit/server/**/*.test.ts", "tests/integration/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          setupFiles: ["tests/helpers/server-setup.ts"],
        },
      },
      {
        test: {
          name: "web",
          environment: "jsdom",
          include: ["tests/unit/web/**/*.test.ts"],
          setupFiles: ["tests/helpers/web-setup.ts"],
          alias: {
            "@web": resolve(__dirname, "apps/web/src"),
          },
        },
      },
    ],
  },
});
