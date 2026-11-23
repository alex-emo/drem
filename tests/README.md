# 测试目录

Dream 的测试全部放在仓库根的 `tests/`，用 [Vitest](https://vitest.dev/) 驱动，按"能不能碰网络/进程"
拆成三层。`apps/` 下不放任何测试文件。

```text
tests/
  helpers/
    server-setup.ts     # server 工程的全局 setup：临时 DB / 备份目录 + DREAM_MOCK=1
    web-setup.ts        # jsdom 补丁：crypto.subtle、Blob.stream
    fixtures.ts         # 建真实用户（createTestUser）、清业务表（resetTables）
    sse.ts              # SSE 文本解析、ReadableStream 构造
  unit/
    server/             # 纯逻辑：协议、参数校验、Key 池、限流、上下文压缩、流归一化、DB 辅助函数
    web/                # 纯逻辑 + jsdom：utils、分支视图、加密、api 客户端、ZIP 导入、IndexedDB/备份
  integration/          # 真进程：spawn `tsx apps/server/src/index.ts`，用 fetch 打 HTTP 接口
    helpers/server.ts   # 随机端口 + 临时库启动/停止服务
    helpers/api.ts      # ApiClient（自动带 Bearer）、registerTestUser
  e2e/                  # 可选 Playwright 冒烟，见 tests/e2e/README.md（不在 npm test 内）
  tsconfig.json         # 测试代码的类型检查用（npm run test:types）
```

## 怎么跑

```bash
npm test                  # 全部 unit + integration
npm run test:server       # 只跑 server 工程（unit/server + integration）
npm run test:web          # 只跑 web 工程（unit/web，jsdom）
npm run test:integration  # 只跑集成测试
npm run test:coverage     # 覆盖率（v8，输出到 coverage/）
npm run test:types        # 测试代码 tsc 类型检查
npm run test:watch        # 监听模式
```

单个文件 / 用例：

```bash
./node_modules/.bin/vitest run tests/unit/server/protocol.test.ts
./node_modules/.bin/vitest run -t "错误码"
```

> 注意：`npx vitest` 会尝试联网安装，直接调用 `./node_modules/.bin/vitest`。

## 环境隔离

- `tests/helpers/server-setup.ts` 在**任何 server 模块被 import 之前**设置环境变量：
  每个 worker 用 `mkdtemp` 生成独立的 `DREAM_DB_PATH` / `DREAM_BACKUP_DIR` / `DREAM_DOWNLOAD_DIR`，
  并强制 `DREAM_MOCK=1`。所以单元测试不会读写仓库里的 `data/dream.db`，也不会打真实上游。
- 集成测试通过子进程环境变量再覆盖一遍，并把限流阈值调大，避免用例之间互相 429。
- web 测试用 jsdom + `fake-indexeddb`，IndexedDB 在每个用例里重建（`new IDBFactory()` + `vi.resetModules()`），
  因为 `apps/web/src/lib/db.ts` 在模块顶层持有连接。
- 测试代码不会读取仓库根的 `.env` 作为依赖：setup 先把关键变量写死，`config.ts` 的 loadDotenv 不覆盖已有值。

## 约定

- 测试名用中文描述"行为 + 期望"，不用 "should work" 这类空话。
- 断言行为而不是实现细节；确需固定文案时断言关键字（例如 `"请先登录"`）。
- 上游错误用 `vi.stubGlobal("fetch", ...)` 打桩，不引入额外 HTTP mock 库；每个用例后 `vi.unstubAllGlobals()`。
- 涉及时间的用例用 `vi.useFakeTimers()`，涉及随机 id 的用注入/打桩，保证可重复。
- 已知的实现缺口用 `it.fails(...)` 记录（例如 `streamChat` 网络错误未包装成 `NETWORK`），
  并在旁边写明原因；修好实现后把 `it.fails` 改回 `it`。

## 覆盖范围

| 层 | 覆盖的模块 |
| --- | --- |
| unit/server | `protocol`、`deepseek`（参数校验/错误映射/请求构造）、`keys`、`rateLimit`、`context`（估算/裁剪/压缩/缓存）、`stream`、`files`、`password`/`auth`、`backups`、`settings`/`usage`/`logs`、`share`/`archiveImport`（URL 校验）、`db` 辅助函数、`release` |
| unit/web | `utils`、`branches`、`crypto`、`auth`、`api`（SSE 解析/错误映射/重试）、`shareImport`、`importArchive`（ZIP 解析与分支选择）、`db` + `backup`（加密落库、导出/导入、旧格式兼容） |
| integration | 健康检查/版本/模型、鉴权全流程、文件上传、SSE 聊天（mock 上游）、上下文预热、备份上传下载（新流式 + 旧 base64）、管理后台（统计/日志/模型设置/公告/用户禁用/改密/踢下线）、限流 429、导入校验 |

未覆盖（需要外部依赖，暂不做）：真实 DeepSeek/Qwen 上游调用、`search.ts` 的联网搜索流、S3 云备份
（`cloudSync`）、Capacitor 移动端。
