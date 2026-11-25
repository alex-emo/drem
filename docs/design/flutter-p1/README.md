# Flutter P1 全功能实现 · 规划总览

> 目标：在 `feat/flutter-mobile-rewrite` 分支，把 Dream 稳定版（当前 web + 旧 Capacitor 移动端）全部功能实现到 `apps/mobile_flutter`。设计哲学不变（Quiet Instrument），功能对齐，底层实现优化（分层 / 可测试 / 类型安全 / 少依赖）。
> 约束：不部署、不改 server/web/master、不改 `apps/mobile` 旧壳。只新增/改 `apps/mobile_flutter` 与 `docs/design/flutter-p1/`。

## 1. 功能矩阵（对齐稳定版）

| 域 | 功能 | 优先级 |
|---|---|---|
| 账号 | 注册 / 登录 / 登出 / me / 多设备 | P1 |
| 聊天 | SSE 流式、深度思考、停止、编辑（版本树）、分支切换、重新生成、删除会话、长对话上下文裁剪重试 | P1 |
| 消息持久化 | 本地加密存储（会话/消息/墓碑）、启动恢复 | P1 |
| 文件附件 | 上传文本/docx（≤1MiB）、附件列表、聊天引用 | P1 |
| 语音 | HTTP ASR + WS 实时转写 | P1 |
| 联网搜索 | webSearch + sources 展示 | P1 |
| 云备份 | 加密云备份 meta/stream、合并、节流/防抖、legacy 回退、密钥迁移 | P1 |
| 导入 | 分享链接导入、ZIP 归档导入（华为云 OBS + manifest v3） | P2 |
| 设置 | 主题 / 内容宽度 / 账号 / 数据管理（清空/导出/导入/恢复）/ 反馈 | P1 |
| 更新 | APK 版本检查 + 下载安装 | P2 |
| 管理后台 | web 专属，Flutter 不做 | — |

## 2. 架构分层

```
lib/
  core/           领域模型 + 纯函数（消息树、裁剪、id、错误映射）——无 IO、可单测
  services/       ApiClient(HTTP+SSE)、SessionStore、Crypto、DeviceInfo
  data/           存储：sqflite 仓库实现、Repository 接口
  app/            AppScope(DI)、Router、ThemeController、SessionController
  features/       chat / attach / voice / cloud / import / settings / update
  design/         现有设计系统（tokens/theme/context_extension）
  shared/         通用 widget / 轻量 markdown 渲染器
```

## 3. 关键架构决策（冻结）

- **状态管理**：`ChangeNotifier` + 自研 `AppScope`（`InheritedNotifier`）注入，不引 provider/riverpod。领域状态用 sealed class（如 `StreamPhase`、`MessageStatus`）。
- **DI**：`AppScope` 暴露 `ApiClient` / `SessionController` / `SettingsController` / 各 repository；经 `context.scope` 扩展访问（仿现有 `context.dreamPalette`）。
- **本地存储**：`sqflite`（SQLite），库名 `dream_flutter`，表 `conversations` / `messages` / `tombstones`（语义对齐 web 的 IndexedDB）。**不用 drift**（避免 build_runner 复杂度）。
- **加密**：`cryptography` 包 AES-GCM，IV 12B，key = `SHA-256(sessionKey)`（与 web 一致）。
- **网络**：`http` 包 + 手写 SSE 解析；取消用 `http.Client.close()`；超时/裁剪重试逻辑对齐 web。
- **凭据/密钥**：`flutter_secure_storage` 存 token / sessionKey / deviceId；`shared_preferences` 存非敏感（主题、内容宽度、云节流标记）。
- **markdown**：`flutter_markdown` 已停更，**自研**轻量流式 markdown（inline：粗体/斜体/行内代码/链接；块级：标题/代码块/列表/引用/表格）。
- **依赖版本**（pub 镜像已验证）：`http 1.6.0`、`sqflite 2.4.6`、`path_provider 2.1.6`、`flutter_secure_storage 11.2.0`、`cryptography 2.9.0`。

## 4. 子代理分工（disjoint write scopes）

| 子代理 | 写范围（lib/ 下） | 职责 | 依赖 |
|---|---|---|---|
| core-dev | `core/**`、`services/**`、`data/**` | 领域模型、消息树纯函数、错误映射、ApiClient+SSE、Crypto、SessionStore、sqflite 仓库 | 无（先做，产出契约接口） |
| chat-dev | `features/chat/**` | ChatController 状态机、树切换/编辑/重生成 UI、流式渲染、上下文裁剪 | core |
| media-dev | `features/attach/**`、`features/voice/**` | 文件上传、语音 HTTP+WS、附件引用 | core |
| sync-dev | `features/cloud/**`、`features/import/**`、`features/settings/**`、`features/update/**` | 云备份/合并/节流、分享/ZIP 导入、设置页、数据管理、APK 更新 | core |

集成顺序：core-dev 先落 `core`/`services`/`data` 的公开接口与模型 → chat/media/sync 三路并行 → Lead 集成 `app/`（AppScope 装配、路由守卫、登录流程）、跑 analyze/test、回填契约。

## 5. 验收

`flutter analyze` 0 issues；`flutter test` 全绿（每域补 widget/unit 测试）；`flutter build apk --debug` 成功并装真机；提交原子化 + push 分支。

## 6. 契约文档索引

- `api.md` — HTTP 端点 / SSE / 错误码 / 认证 / 云备份协议
- `chat.md` — 聊天状态机 / 消息树 / 本地持久化 / 上下文裁剪 / 云推送
- `files-voice-import.md` — 文件 / 语音 ASR(HTTP+WS) / APK 更新 / 分享与 ZIP 导入 / 移动端存储语义
