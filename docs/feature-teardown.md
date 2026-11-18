# Dream · DeepSeek C 端功能拆解（v0.1）

> 目标：最大程度复刻 DeepSeek C 端（Web + 安卓 App）的**功能与交互**。
> 本文基于 2026-11-18 时点可查的官方资料、官方开源 demo 与线上页面实测整理。
> 结论先行：**官方已于 2026-11-13 开放“全家桶应用 API”，并明确表示可 1:1 复刻 DeepSeek App；官方还开源了 MIT 协议的 chat-demo。我们的工作重心应是“外壳 + 账号体系 + 移动端 + 服务端代理”，而不是从零猜交互。**

---

## 1. 情报基线（可信来源）

| 情报 | 内容 | 来源 |
| --- | --- | --- |
| 全家桶应用 API | 联网搜索、深度思考搜索、文件输入、阅读链接、模型安全、OCR/ASR/TTS 全部开放，`deepseek-flash` 支持；搜索/抓取均由服务端完成 | https://api-docs.deepseek.com/zh-cn/news/news261113/ |
| 官方 Demo | MIT 开源静态客户端，React 18 + zustand + idb（IndexedDB）+ rspack；支持导入 DeepSeek 网页端导出的历史对话 ZIP | https://github.com/deepseek-ai/chat-demo |
| 交互基线 | 线上 Demo（https://cdn.deepseek.com/chat-demo）与 chat.deepseek.com 同一套 DSW 设计系统 | 实测 CSS 变量 |
| 登录页 | chat.deepseek.com 未登录仅暴露：手机号输入框、验证码输入框、用户协议、隐私政策 | 实测页面 |
| 设计 token | 见第 5 节（浅色/深色双套，取自线上 CSS 变量） | 实测 |
| 移动端新能力 | App 灰度“语音对话”（4 种音色）；Web 灰度“历史对话搜索” | 社区报道，**待验证** |

**关键推论**：DeepSeek 的服务端工具（文字搜索、图片搜索、网页抓取）**不额外计费**，只计模型 Token；OCR 单独按页计费。这让我们可以放心把“智能搜索/阅读链接”做成默认能力。

---

## 2. 端形态与信息架构

### 2.1 页面/路由

| 端 | 路由 | 说明 |
| --- | --- | --- |
| Web | `/sign_in` | 手机号 + 短信验证码；协议勾选；单一设备策略入口 |
| Web | `/` | 主对话页（侧边栏 + 对话区 + 输入区） |
| Web | 设置弹窗 | 通用设置 / 数据管理（非独立路由） |
| Web | 分享页（待验证） | DeepSeek 网页端是否对外开放分享链接需实测；官方 Demo 无分享 |
| Android | 单 Activity | 与 Web 同构；原生层负责录音权限、TTS 播放、返回键、安全区、分享/导出 |

### 2.2 主界面布局（Web，实测 Demo）

```
┌───────────────┬──────────────────────────────────────────────┐
│ 顶部 Logo      │ 顶部：会话标题 / 模型选择（DeepSeek 网页端有）   │
│ [开启新对话]   │                                              │
│ ─────────────  │              对话区（居中，max-width ~768px）  │
│ 历史会话列表   │  用户消息：右对齐气泡                           │
│  今天          │  助手消息：无气泡，全宽 Markdown 渲染            │
│  昨天          │    ├─ 思考过程（可折叠）                        │
│  7 天内        │    ├─ 搜索卡片（标题/站点图标/摘要）             │
│  30 天内       │    └─ 正文 + 引用角标 [1]                        │
│  更早          │                                              │
│ ─────────────  │  ┌────────────────────────────────────────┐  │
│ 用户菜单       │  │ 输入区（圆角 22px，随内容长高）            │  │
│ (主题/语言/    │  │ [深度思考] [智能搜索]      [语音][上传][发送]│  │
│  数据/退出)    │  └────────────────────────────────────────┘  │
└───────────────┴──────────────────────────────────────────────┘
```

- 侧边栏约 260px，可收起；会话项 hover 出现“更多”（重命名/置顶/删除）。
- 空态：`今天有什么可以帮到你？`（Demo 实测文案，24px/600）。
- 输入区底部有免责声明小字（DeepSeek 网页端：“内容由 AI 生成，请仔细甄别”）。
- 移动端：侧边栏改为抽屉；输入区贴底并适配安全区；录音时输入框首行显示实时频谱（Demo 已有该细节）。

### 2.3 核心对象

- `Conversation`：标题、创建/更新时间、置顶、是否开启深度思考、是否开启智能搜索、当前模型。
- `Message`：角色、内容块数组（思考/工具调用/工具结果/正文/引用）、分支 parentId、状态（streaming/done/stopped/error）、usage、附件引用。
- `Attachment`：本地原件（图片）+ 远端 `file_id`（文档经 Files API 解析）。
- `Device`（服务端）：设备指纹、平台、最后活跃、是否被踢。

---

## 3. 功能矩阵（P0 = 首版必须）

来源标记：✅ 官方文档/Demo 已验证；⚠️ 社区信息，待实测。

| # | 功能 | DeepSeek 表现 | 优先级 | Dream 实现路径 |
| --- | --- | --- | --- | --- |
| 1 | 登录 | 手机号 + 验证码；协议 | P0 | 服务端账号体系；短信可后置 |
| 2 | 单一设备会话 | 官方无（单账号多端并存） | P0 | 服务端 device 绑定 + 新登录踢旧 |
| 3 | 用户管理 | 官方无 C 端后台 | P0 | 管理后台：用户 CRUD/禁用/改密/设备解绑/用量 |
| 4 | 会话列表/新建/重命名/删除 | ✅ | P0 | 本地 IndexedDB；分组按 今天/昨天/7 天/30 天/更早 |
| 5 | 自动标题 | ✅ `title: {enabled:true}`，标题随 `message_delta` 返回 | P0 | 直接透传；本地写回会话标题 |
| 6 | 流式对话 | ✅ SSE，thinking/tool/text 多块 | P0 | 服务端 SSE 透传（保持原始事件形状） |
| 7 | 停止生成 | ✅ | P0 | AbortController + 服务端断开 |
| 8 | 重新生成 | ✅ | P0 | 以同一分支重新请求，新增分支 |
| 9 | 编辑提问 | ✅ | P0 | 编辑后从该分支重发 |
| 10 | 消息分支切换 | ✅ Demo | P0 | `< 2/2 >` 分支切换器 |
| 11 | 继续生成 | ✅（用过联网工具的回复不可续写） | P1 | 未完成 assistant 结尾续写 |
| 12 | 深度思考 | ✅ 可折叠“已深度思考（用时 X 秒）” | P0 | thinking 块 + signature 原样回传 |
| 13 | 智能搜索 | ✅ `deepseek_web_search`；搜索卡片 + 引用角标 | P0 | 工具块渲染；引用可点击跳转 |
| 14 | 阅读链接 | ✅ `deepseek_read_url`；“阅读了 N 个网页” | P0 | 工具块渲染；signature 原样回传 |
| 15 | 文件上传 | ✅ PDF/Word/PPT/图片；`text_recognition` 与 `rich_layout_recognition` | P0 | 服务端 Files API 代理；附件卡片 |
| 16 | 文本/表格/电子书 | ✅ `user_data`：txt/md/csv/json/代码/XLSX/XLS/EPUB/MOBI，原文件 ≤32MiB | P1 | 同上，不计费 |
| 17 | 图片理解/图片搜索 | ✅ 图片进上下文；带图可触发 `image_search` | P1 | 图片块 + 图片结果卡片 |
| 18 | Markdown | ✅ GFM、表格、任务列表 | P0 | mdast/micromark（Demo 同栈） |
| 19 | 代码高亮 | ✅ 语言标签 + 复制 + 折行 | P0 | Prism |
| 20 | 公式 | ✅ KaTeX | P0 | katex |
| 21 | Mermaid | ✅ Demo | P1 | mermaid |
| 22 | 复制消息/代码 | ✅ | P0 | clipboard |
| 23 | 点赞/点踩 | ✅ 网页端 | P2 | 本地记录 + 可选上报 |
| 24 | 语音输入 | ✅ ASR | P1 | 移动端 MediaRecorder → `/asr` |
| 25 | 朗读回答 | ✅ TTS | P1 | `/tts` → 音频播放 |
| 26 | 语音对话（App 灰度） | ✅ 4 种音色 | P2 | 需额外会话式语音链路，后置 |
| 27 | 历史搜索 | ⚠️ Web 灰度 | P1 | 本地 FTS（IndexedDB 内检索） |
| 28 | 分享会话 | ⚠️ 疑似有 | P2 | 服务端只存“快照”，不存聊天历史 |
| 29 | 导入/导出 | ✅ ZIP（官方导出格式） | P1 | 兼容 DeepSeek 导出 ZIP |
| 30 | 主题/语言/所在地 | ✅ 浅色/深色/跟随系统；简中/英文；所在地传给 `latest_reminder` | P0 | `latest_reminder` + i18n |
| 31 | 模型切换 | ✅ 网页端下拉（待验证 2026 版本） | P2 | 服务端白名单透传 |
| 32 | 移动端适配 | ✅ | P0 | 响应式 + 安全区 |
| 33 | 快捷键 | 网页端有（待实测） | P2 | Enter 发送 / Shift+Enter 换行等 |
| 34 | PWA/离线外壳 | 官方无 | P2 | 可选 |

---

## 4. 关键交互规格（实现时按此验收）

### 4.1 流式内容块

一次回答可能包含（按到达顺序）：`thinking` → `server_tool_use` → `web_search_tool_result` / `web_fetch_tool_result` → `thinking` → 带 `citations` 的 `text` → … → `message_delta`（含 `title`、`usage`）。

- 思考块：默认折叠，标题 `已深度思考（用时 X 秒）`；展开显示流式思考文本；思考结束时显示耗时。
- 搜索卡片：`标题 + 站点名 + 站点图标 + 摘要 + 日期`；图片搜索显示缩略图；失败显示“搜索失败”。
- 阅读链接：`阅读了 N 个网页` 折叠列表；失败区分 `url_not_accessible / url_not_allowed / unavailable`。
- 引用角标：正文中的 `[1]` 可点击/悬浮显示来源；同一正文块同一 URL 最多一次。
- 拒答：`stop_reason: "refusal"` 时用本地拒答文案替换已渲染内容。
- 生成失败：以 `error` 事件结束（HTTP 200），显示“生成失败，请重试”，保留已生成部分。
- 流式空闲：服务端会发 `: keep-alive` 注释，前端需忽略。

### 4.2 多轮上下文

- 每次都带完整历史；**assistant 消息原样回传**（保留 `kind`、`signature`、`encrypted_content`）。
- 历史中的搜索/思考内容不会进入后续上下文，只有正文；文档 `file_id` 内容会一直保留。
- 使用过联网工具的回复不能“继续生成”（400），改为重发。

### 4.3 输入区

- 自适应高度（约 1～8 行），超出滚动。
- 发送/停止按钮互斥；生成中按钮变“停止”。
- 拖拽/粘贴图片、文件即入附件区；附件显示缩略图/文件卡片，可删除。
- 深度思考、智能搜索为开关式按钮（高亮态）；状态随会话保存。
- 移动端：回车换行、按钮发送；录音权限、取消录音、转写中状态。

### 4.4 消息操作

- 助手消息 hover：复制、重新生成、点赞/点踩；用户消息 hover：复制、编辑、分支切换。
- 重新生成产生新分支，旧分支保留可切换。
- 滚动：生成中自动贴底；用户上滑后停止自动滚动并显示“回到底部”。

### 4.5 数据管理

- 设置 → 通用设置：语言（简中/英文）、主题（跟随系统/浅色/深色）、所在地。
- 设置 → 数据管理：导入历史（ZIP，覆盖式）、导出所有历史（含图片原件，不含 API Key/非图片原件）、删除所有对话（二次确认，停止生成，清空草稿）。
- 导入会覆盖全部本地会话与附件，必须确认并校验成功后才替换（官方 Demo 语义）。

---

## 5. 设计 Token（实测，直接可用）

### 5.1 颜色

| Token | 浅色 | 深色 |
| --- | --- | --- |
| 页面底色 `bg-base` | `#fff` | `#151517` |
| 侧边栏 `sidebar-fill` | `#f9fafb` | `#1b1b1c` |
| 气泡/输入框 `bubble` | `#f1f3f5`（推断） | `#2c2c2e` |
| 卡片层 3 `bg-layer-3` | `#f5f5f5`（推断） | `#353638` |
| 品牌色 `brand-primary` | `#3964fe` | `#5686fe` |
| 文字主 `label-primary` | `#1b1b1c` | `#f9fafb` |
| 文字次 `label-secondary` | `#61666b` | `#cfd3d6` |
| 文字弱 `label-tertiary` | `#81858c`（推断） | `#adb2b8` |
| 危险 `error-primary` | `#ec1313`（推断） | `#f25a5a` |
| 边框 `border-l2` | `rgba(0,0,0,.12)`（推断） | `rgba(255,255,255,.12)` |

> 带“推断”的是浅色主题下未实测值，实现时以官方 CSS 为准再校一次。

### 5.2 字体/尺寸

- 字体：`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`；代码：Menlo/Monaco/Consolas/JetBrains Mono…
- 基准字号 14px，行高 22–24px；空态标题 24px/600；Markdown h1 24px/34px、h2 22px/32px、h3 20px/30px。
- 控件高度：28/32/36/40/44px。
- 圆角：输入区 22px；代码块 12px；卡片约 16px（待实测）。
- 过渡：0.2s / 0.3s，`cubic-bezier(.4,0,.2,1)`。
- 阴影 lv3：`0 0 1px rgba(0,0,0,.2), 0 0 4px rgba(0,0,0,.02), 0 12px 32px rgba(0,0,0,.08)`。

### 5.3 图标/文案

- 官方 Demo 的按钮 aria-label：`收起边栏 / 开启新对话 / 深度思考 / 智能搜索 / 语音输入 / 上传文件 / 发送 / 设置 / 通用设置 / 数据管理`。
- 注意：新版文案是**“智能搜索”**，不是旧版“联网搜索”。

---

## 6. 系统架构（按你的约束）

约束：Android + Web 双端；服务端只做转发与用户管理；聊天记录存本地；登录 + 单一设备。

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ Web (React 18 + Vite)       │        │ Android (Capacitor WebView)  │
│  · 聊天 UI / Markdown 渲染   │        │  · 同一套 Web 产物            │
│  · IndexedDB 存会话/附件     │        │  · 录音/TTS/返回键/安全区插件  │
└──────────────┬──────────────┘        └──────────────┬───────────────┘
               │  HTTPS/SSE（只带 Dream 自己的 token） │
               ▼                                      ▼
        ┌────────────────────────────────────────────────────┐
        │ Dream Server（Node 22 + Hono + SQLite）             │
        │  · 登录/刷新/登出，JWT + device 绑定（单设备）         │
        │  · 用户管理 / 管理后台 API                            │
        │  · /chat SSE 透传（注入 DeepSeek Key、安全参数）       │
        │  · /files 代理（Files API） · /asr · /tts 代理         │
        │  · 限流 / 配额 / 审计日志（不落聊天内容）               │
        └──────────────────────┬─────────────────────────────┘
                               │ DeepSeek 全家桶 API
                               ▼
                  api.deepseek.com（deepseek-flash）
```

### 6.1 技术选型建议（待你拍板）

- **前端**：React 18 + TypeScript + Vite + zustand + idb，直接以官方 MIT chat-demo 为 UI 基座（保留 LICENSE 与版权声明），可最大化“像”。
- **Android**：Capacitor 7 包同一套 Web 产物（最快），原生插件补录音权限、TTS、返回键、安全区；若你要求原生 UI 再评估 Flutter/Kotlin。
- **服务端**：Node 22 + Hono（轻、SSE 友好）+ SQLite（better-sqlite3 / Drizzle）；部署在你自己的服务器，Nginx/Caddy 反代 + HTTPS。
- **单体仓库**：pnpm workspace：`apps/web`、`apps/server`、`apps/android`、`packages/shared`（协议类型/内容块定义）。

### 6.2 账号与“单一设备”

- 登录成功 → 服务端签发 `access_token`（短）+ `refresh_token`（长），二者都记录 `device_id`。
- 同一账号只保留一个有效 session：新设备登录时，旧 session 立即失效；旧端收到 401 后展示“账号已在其他设备登录”并回到登录页。
- 换设备：管理员/本人在后台“解绑设备”后才可登录（若你要求的是**账号永久绑定一台设备**，实现为 devices 表唯一约束）。
- 密码建议 Argon2/bcrypt；`device_id` 由客户端生成并持久化（Android 用 ANDROID_ID 哈希，Web 用随机 UUID 存 IndexedDB）。

### 6.3 本地存储

- 会话、消息、附件原件全部 IndexedDB（Web/Android WebView 均持久）。服务端**不存聊天内容**，只存账号/设备/会话元统计。
- 导出/导入沿用官方 Demo 的 ZIP 格式（与 DeepSeek 网页端导出兼容），换设备可迁移。
- 隐私提示：发送对话、上传附件、语音识别时，内容经 Dream Server 转发给 DeepSeek。

---

## 7. 数据模型（草案）

### 7.1 本地（IndexedDB，库名 `dream`）

```ts
conversations: { id, title, createdAt, updatedAt, pinned, thinkingEnabled, searchEnabled, model, lastMessageAt }
messages: { id, conversationId, parentId, role, blocks: ContentBlock[], status, usage, error?, createdAt }
attachments: { id, conversationId, messageId?, name, mime, size, kind: 'image'|'document'|'text', localBlob?, remoteFileId?, purpose? }
settings: { theme, language, location, deviceId }
```

`ContentBlock` 与 DeepSeek 响应块一一对应（`thinking` / `server_tool_use` / `web_search_tool_result` / `web_fetch_tool_result` / `text` + `citations`），另加 UI 用的 `file`、`error` 块。

### 7.2 服务端（SQLite）

```sql
users(id, username, password_hash, role, status, created_at, updated_at)
devices(id, user_id, name, platform, last_seen_at, revoked_at, UNIQUE(user_id))  -- 单一设备
sessions(id, user_id, device_id, token_hash, expires_at, revoked_at)
usage_daily(user_id, day, input_tokens, output_tokens, requests)
audit_logs(id, user_id, action, ip, created_at)
```

---

## 8. 服务端接口面（草案）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | `{username,password,device:{id,name,platform}}` → tokens；踢旧设备 |
| POST | `/api/auth/refresh` | 刷新 access token |
| POST | `/api/auth/logout` | 注销当前设备 |
| GET | `/api/me` | 用户信息 + 当前设备 |
| POST | `/api/v1/chat` | 流式对话（SSE 归一化事件），服务端注入模型与 Key；详见 `docs/api.md` |
| POST | `/api/files` | multipart → Files API，返回 `file_id`/`purpose` |
| POST | `/api/asr` | 音频 → 文本 |
| POST | `/api/tts` | 文本 → 音频 |
| GET/POST/PATCH | `/api/admin/users` | 用户列表/创建/禁用/改密/角色 |
| GET/POST/DELETE | `/api/admin/users/:id/devices` | 查看/解绑设备 |
| GET | `/api/admin/usage` | 用量统计 |

约定：所有响应体不落聊天内容；日志脱敏；每用户限流（如 20 req/min，可配）。

---

## 9. 与 DeepSeek C 端的必要差异（必须提前接受）

1. **不能用手机号+短信验证码原样复刻**（需要短信服务商）；建议用户名+密码，或邮箱验证码后置。
2. **单一设备**是官方没有的策略，会改变使用习惯：手机登录会把 Web 踢下线。
3. **聊天记录在本地**：换浏览器/换机/清缓存即丢（靠 ZIP 导出迁移）；官方是云端存储。
4. **服务端只转发**：意味着搜索/文件/语音全部走 DeepSeek API，费用与速率受 API 账号额度约束。
5. **品牌**：界面、文案、图标若继续使用 DeepSeek 名称/Logo 有商标风险；建议保留布局与交互，换 Dream 品牌视觉。
6. 若对外提供服务：需开启 `safety_check`，并自行承担内容审核、大模型登记、AI 标识等义务（官方文档明确要求）。

---

## 10. 里程碑（建议）

- **M0 骨架**：monorepo、设计 token、静态外壳（侧边栏/对话区/输入区）、主题切换。
- **M1 账号**：服务端登录/刷新/登出、单设备踢下线、管理后台（用户/设备/用量）。
- **M2 对话**：SSE 透传、会话 CRUD、本地存储、Markdown/代码/公式、停止/重新生成/编辑/分支。
- **M3 能力**：深度思考、智能搜索、引用、文件上传（Files API）、自动标题。
- **M4 增强**：导入导出、历史搜索、ASR/TTS、Mermaid、错误态/拒答。
- **M5 安卓**：Capacitor 打包、录音权限、返回键、安全区、真机验收、签名 APK。
- **M6 打磨**：交互细节对齐（hover/滚动/快捷键）、性能、PWA/分享（可选）。

---

## 11. 待你确认的问题

1. **登录方式**：用户名+密码（推荐，自己做账号）？还是手机号+验证码（需短信通道）？
2. **“单一设备”语义**：只允许一台**在线**（新登录踢旧），还是账号**永久绑定一台设备**（换机需管理员解绑）？
3. **用户管理**：谁使用？只给自己/小团队用（简单后台即可），还是要给外部用户开放注册？
4. **品牌**：界面保留 DeepSeek 视觉与文案，还是换 Dream 品牌、只复刻交互？
5. **是否基于官方 MIT chat-demo 二次开发**（推荐：复用 UI/存储/导入格式，省 2～3 周）？
6. **安卓形态**：Capacitor 包 WebView 可接受吗？还是必须原生/Flutter？
7. **部署**：服务端部署在你自己的服务器（域名+HTTPS）？预计并发/用户量级？

---

## 12. 实现进度（2026-11-18）

**M0 已完成并在本地验证**（Web 客户端 + 本地转发服务）：

- monorepo（`apps/web`、`apps/server`）、统一 dev 脚本、README 与截图
- 设计 token 落地：深/浅色主题、侧边栏 264px、气泡/输入区/代码块样式、移动端断点
- `POST /api/v1/chat` 服务端校验 + 上游 SSE 解析归一化（start/thinking/delta/done/error）+ AbortSignal 传播
- App ↔ Server 契约 v1 已固化：`docs/api.md`（权威）、`docs/openapi.yaml`；统一错误体与错误码、`X-Request-Id`
- `/api/v1/health`（模式/模型/Key 状态）、`/api/v1/models`
- Web 流式渲染、停止生成、Markdown/GFM/代码高亮/复制、多轮上下文、自动标题
- 深度思考开关与 `reasoning_content` 折叠块
- IndexedDB 持久化（会话/消息）、刷新后恢复上次会话、主题偏好持久化
- 错误态：无 Key 时 503 可读提示；无效 Key 时上游 401 映射为 502 并透出信息
- `DREAM_MOCK=1` 本地模拟流，便于无 Key 演示与回归
- 设置弹窗（通用设置 / 数据管理）
- 导入 DeepSeek 客户端导出 ZIP（格式版本 3）：按 `current_message_id` 还原当前分支，导入提问、回答、思考；重复会话去重；附件暂不支持
- 真实 API 联调通过：`deepseek-chat` / `deepseek-reasoner` 均由账号映射到 `deepseek-flash`，思考流返回 `reasoning_content`

验证证据：`npm run typecheck` 与 `npm run build` 通过；浏览器实测新建/切换/删除会话、流式输出、停止生成、刷新恢复、深浅色切换均正常；对 `api.deepseek.com` 用真实 Key 联调普通回复与深度思考成功（401 映射测试用无效 Key 完成）；导入用构造的 DeepSeek 导出 ZIP 验证（2 会话、分支裁剪、思考块、重复导入跳过、损坏 ZIP 错误提示）。

**实现口径说明**：

- 首版选择自研 React 界面（未 fork chat-demo），按其 UI 规格与实测 token 对齐。
- 服务端只转发文本 Chat Completions，尚未接入新的 Messages/Files 全家桶工具。
- 登录、单设备、用户管理尚未实现（M1 下一步）。

---

## 附：参考链接

- 全家桶应用 API 发布：https://api-docs.deepseek.com/zh-cn/news/news261113/
- 构建 Chatbot 指南：https://api-docs.deepseek.com/zh-cn/guides/build_a_chatbot
- 联网工具：https://api-docs.deepseek.com/zh-cn/guides/web_tools
- 文件解析：https://api-docs.deepseek.com/zh-cn/guides/document_parsing
- 官方 Demo 源码（MIT）：https://github.com/deepseek-ai/chat-demo
- Demo 在线体验：https://cdn.deepseek.com/chat-demo
- DeepSeek 登录页（实测）：https://chat.deepseek.com/sign_in
