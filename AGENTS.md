# AGENTS.md — Dream 项目 AI 接手行为规范

> 面向接手本项目的编码 AI / Agent。开始改代码前必须先读完本文件，再读 `README.md`、`docs/deploy.md`、`docs/api.md`、`docs/mobile.md`、`tests/README.md` 和最近 20 条 `git log`。
>
> 最后更新：2026-11-23 · 线上 `1.7.5 / versionCode 28` · 默认分支 `master`

---

## 1. 项目是什么

Dream 是一个尽量贴近 DeepSeek C 端体验的聊天客户端：

- Web：`apps/web`（React 18 + Vite）
- 服务端：`apps/server`（Hono + SQLite，单进程 Node 22）
- 移动端：`apps/mobile`（Capacitor + React，Android / iOS 共用 WebView 壳）
- 线上：`https://dream.pum.org.cn`，Cloudflare 命名隧道 → 服务器 127.0.0.1:8787
- 上游模型：Qwen（通过 DashScope 兼容端点）；**对用户只暴露 Dream 身份，不暴露上游厂商**

核心原则：聊天记录以客户端本地为主，云端只存加密备份；服务端不保存可读聊天内容。

---

## 2. 最高优先级规则（不可违反）

### 2.1 发布必须得到明确指令

- 默认只做**本地修改 + 本地构建 + 测试**。
- 只有用户明确说“发布 / 部署 / 上线 / 推生产”时才允许部署。
- 发布前必须执行 `npm run version:check`，并且服务端、Android、iOS、`apps/mobile/package.json` 版本一致。
- 不允许“顺手”部署、不允许只改服务端不更新 APK、不允许改完代码不提交就部署。
- 发布后必须验证：`/api/v1/release`、APK SHA-256、`/api/v1/health`、至少一次真实聊天。

### 2.2 不暴露上游，不伪造事实

- 用户可见身份只能是 **Dream 模型 / Dream 团队**。
- 不得在用户可见文本、错误信息、日志响应、APK、Web 资源里出现 `Qwen`、`通义`、`阿里云`、`DashScope`、`DeepSeek` 等上游信息。
- 但**不要**用全局字符串替换、正则清洗、整条消息重写来“去厂商化”。历史版本这样做过，会破坏代码、财报、论文、地名等正常内容，已被明确要求停用。
- 正确做法：在 system prompt 里声明 Dream 身份；用户可见错误走固定错误目录（`apps/server/src/protocol.ts` 的 `hex + 中文`）。
- 如需改身份提示，只能改 `apps/server/src/settings.ts` 的默认提示词或后台“模型设置”，不要改历史消息。

### 2.3 不提交秘密与用户数据

以下内容永远不能进 Git：

- `.env`、`.env.*`（`.env.example` 除外）
- `.deploy/`、`.gh-config/`、`.tools/`、SSH 私钥、PAT、cookies
- `data/`、`apps/server/data/`、`*.db`、`*.sqlite`
- `.android-sdk/`、`.gradle/`、`node_modules/`、`.tmp/`、`coverage/`
- 真实用户聊天记录、备份文件、导出 ZIP

提交前跑：

```bash
git status --short
git diff --cached
```

发现秘密立即停止，先从暂存区移除，再考虑是否需要轮换密钥。

### 2.4 不破坏用户数据

- 本地聊天在浏览器 IndexedDB / App WebView 中；云端备份是客户端加密后的密文。
- 任何“清理、迁移、切账号、删除会话”的改动都必须先确认：
  - 不会在未确认时清空本地；
  - 云同步失败必须可见，不能静默；
  - 删除会话要写 tombstone 并传播；
  - 覆盖安装/升级不能丢本地数据。
- 不允许为了“修一个 UI 问题”而清空 IndexedDB、localStorage 或云端备份。

### 2.5 安全边界

- 请求体必须流式限长，禁止先 `arrayBuffer()` 再检查大小。
- 上传文件 ≤ **1 MiB**；云端备份加密后 ≤ **20 MiB**；归档导入 ≤ **300 MiB**。
- docx 解压必须检查 `word/document.xml` 解压后大小（>20 MiB 拒绝），防止 zip bomb。
- 归档导入 URL 只允许华为云 OBS，且每一跳重定向都要重新校验 hostname。
- 不能信任请求里的 `Host` 拼公开下载地址，使用 `DREAM_PUBLIC_ORIGIN`。
- 日志里不要打印 API Key、密码、token、完整备份、完整聊天正文。

---

## 3. 目录与关键模块

```text
apps/server/src/
  index.ts        路由、中间件、静态托管、发布下载
  auth.ts         注册/登录/session（30 天、单设备）
  password.ts     异步 scrypt
  db.ts           SQLite schema 与迁移
  deepseek.ts     上游请求、参数校验、错误映射
  stream.ts       上游 SSE → Dream SSE（start/thinking/delta/done/error）
  context.ts      token 预算、压缩、摘要、单条裁剪
  files.ts        文本附件、docx 解析、1 MiB 限制
  archiveImport.ts 华为云 OBS 流式导入
  share.ts        DeepSeek 分享链接导入
  backups.ts      云备份流式写入/读取
  keys.ts         上游 Key 轮询池
  rateLimit.ts    IP 限流
  protocol.ts     错误码、中文错误目录、SSE 编码
  settings.ts     模型温度/身份提示
  release.ts      版本、APK SHA-256、下载地址

apps/web/src/
  App.tsx         启动、登录态、云同步入口
  hooks/useChat.ts 聊天状态机（停止/删除/刷新恢复）
  lib/api.ts      客户端 SSE 解析、错误码、裁剪重试
  lib/cloudSync.ts 云端备份拉取/合并/推送
  lib/db.ts       IndexedDB（会话、消息、tombstones）
  lib/crypto.ts   AES-GCM
  components/     ChatView / MessageList / Composer / SettingsDialog / AdminPage

apps/mobile/src/
  services/chat/store.ts   移动端会话存储
  services/dream/          登录、SSE、云同步、文件、更新
  app/App.tsx              移动端壳

tests/
  unit/server, unit/web, integration, e2e
```

---

## 4. 本地开发与验证

### 4.1 安装

```bash
npm install
```

不要随意升级依赖，不要引入新依赖除非确有必要并说明原因。

### 4.2 启动

```bash
npm run dev        # 同时启动 web(5173) + server(8787)
npm run dev:web
npm run dev:server
```

服务端本地默认 8787；Web 通过 Vite 代理 `/api` 到 8787。

### 4.3 提交前必须跑

```bash
npm run typecheck
npm test
npm run build
npm run build:server
npm run mobile:build
```

涉及原生改动时再跑对应构建：

```bash
# Android
cd apps/mobile
DREAM_API_ORIGIN=https://dream.pum.org.cn npm run build:web
npx cap sync android
cd android
GRADLE_USER_HOME=/home/alex/doc/code/project/dream/.gradle \
JAVA_HOME=/home/alex/doc/code/project/dream/.android-sdk/jdk-21.0.13+9 \
ANDROID_HOME=/home/alex/doc/code/project/dream/.android-sdk \
./gradlew assembleDebug --offline
```

APK 产物：`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`。

### 4.4 版本一致性

```bash
npm run version:check
```

必须同时更新：

- `apps/mobile/package.json`
- `apps/mobile/android/app/build.gradle`（`versionCode` / `versionName`）
- `apps/mobile/ios/App/App.xcodeproj/project.pbxproj`（`CURRENT_PROJECT_VERSION` / `MARKETING_VERSION`）
- `apps/server/src/config.ts`（`appVersion` / `appVersionCode`）
- 必要时 `package-lock.json` 中 `@dream/mobile` 的版本

---

## 5. 发布流程（仅当用户明确要求）

1. 确认 `git status` 干净；未提交的别人改动不要覆盖。
2. 升版本：按 §4.4 改齐，跑 `npm run version:check`。
3. 构建：
   ```bash
   npm run build
   npm run build:server
   cd apps/mobile
   DREAM_API_ORIGIN=https://dream.pum.org.cn npm run build:web
   npx cap sync android
   cd android && ./gradlew assembleDebug --offline
   ```
4. 记录 APK SHA-256：
   ```bash
   sha256sum apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
   ```
5. 按 `docs/deploy.md` 上传 `server.mjs`、`apps/web/dist/`、APK，重启 `dream-server`。
6. 线上验证：
   - `GET /api/v1/release`：版本、versionCode、SHA-256、apkUrl
   - `GET /api/v1/health`：`status=ok`、Key 可用
   - 下载 APK 后 `sha256sum` 与 `/release` 一致
   - 页面能登录、能发一条消息、流式正常
7. commit + push；默认分支 `master`。
8. iOS：
   - Linux 不能签名 IPA；只能生成源码同步包 / 未签名 IPA；
   - 版本与 Android 对齐；`dist/index.html` 与 `ios/App/App/public/index.html` SHA-256 必须一致。
   - 未签名 IPA 不能直接装真机，必须 Sideloadly/AltStore/Apple 证书重签。

---

## 6. 当前关键约束（改动前先看）

### 6.1 上下文

- `apps/server/src/context.ts`：60k token 触发压缩，96k 上限，保留最近 24k token / 160 条。
- 单条历史消息 ≤ 6k token，最后一条 ≤ 12k token；摘要块总预算 10k token，递归归并。
- 上游 context length 400 必须映射为 **413 PAYLOAD_TOO_LARGE**，客户端裁剪后重试一次。
- 不要退回到“按字符数截断 + 300k 字符摘要”的旧实现。

### 6.2 云备份

- 服务端流式写盘：`DREAM_BACKUP_DIR`，默认 `data/backups/<userId>.bin`。
- 新接口：`GET /api/v1/backup/meta`、`PUT/GET /api/v1/backup/stream`。
- 旧 `GET/PUT /api/v1/backup` 保留兼容；新客户端优先 meta/stream，`legacy:true` 时回退。
- 加密后上限 20 MiB；超限 413；临时文件必须清理。
- 客户端仍是整份 gzip + AES-GCM，20MB 在低端机仍可能内存峰值；如要继续优化，需分块加密格式，不能只改传输。

### 6.3 错误提示

- 用户可见格式：`0x2002 用户名或密码不正确。（请求编号 req_...）`
- 错误码/中文目录在 `apps/server/src/protocol.ts`；**不要**用正则从上游错误里抽厂商/余额信息。
- 上游原始错误只写 `console.warn` / `error_events`，不回客户端。

### 6.4 会话与限流

- session 30 天过期；新登录踢旧 session（单设备）。
- `last_seen_at` 60 秒节流。
- 限流：注册 12/IP/小时、登录 60/IP/15 分钟、聊天 120/IP/分钟、全局 1200/IP/分钟、归档 12/IP/小时。
- 限流目前信任 `cf-connecting-ip`/`x-real-ip`/`x-forwarded-for`，依赖 Cloudflare Tunnel 前置；换部署方式必须重新评估。

---

## 7. 编码规范

- TypeScript strict；不要用 `@ts-ignore` / `as any` 绕过类型。
- 服务端 API 统一 `/api/v1/...`，错误体 `{error:{code,hex,message,requestId}}`。
- SSE 事件：`start`、`thinking`、`delta`、`done`、`error`；不要新增无文档事件。
- 客户端请求必须支持 AbortController；停止操作必须在**本地队列**也能结算，不能只 abort fetch。
- 数据库改动必须写迁移（`ALTER TABLE` 前检查列），不能假设新库。
- 文件/备份/导入的流式写入必须处理客户端断开、超限、临时文件清理。
- 新增功能必须补测试（unit 或 integration）；至少覆盖错误路径。
- 提交原子化：一个 commit 只做一件事；message 用 `type(scope): summary`。
- 不要格式化整个文件、不要无意义重排、不要改无关代码。

---

## 8. AI 工作方式

1. **先读再改**：读相关文件、测试、git log；不要凭记忆改接口。
2. **先计划后动手**：多文件改动先列步骤；不确定先问，不要猜产品决策。
3. **保护未提交改动**：`git status` 有别人改动时，不要 `git checkout -- .`、不要重置、不要覆盖。
4. **小步验证**：每改一块跑 typecheck/test；不要最后一次性跑。
5. **不发布**：除非用户明确要求；默认本地构建。
6. **不隐藏失败**：云同步、上传、导入失败必须给用户可见提示；不能 catch 后静默。
7. **不伪造结果**：没跑过的测试不要写“通过”；没验证的线上行为不要写“已生效”。
8. **不泄露凭据**：不要在聊天、日志、commit、代码里写密码/token；用环境变量或忽略文件。
9. **交付说清楚**：改了什么、验证了什么、没验证什么、是否部署、风险是什么。

---

## 9. 接手检查清单

- [ ] `git status` 干净，当前分支 `master`
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] `npm run version:check` 通过
- [ ] 读过 `docs/deploy.md` 与 `docs/api.md`
- [ ] 知道当前线上版本（`/api/v1/release`）
- [ ] 知道本次是否允许部署
- [ ] 没把 `.env`、`.deploy`、`data`、token 加进 Git
- [ ] 改动有测试或至少手工验证记录
- [ ] 交付时说明部署状态与残留风险
