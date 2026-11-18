# Dream

一个尽可能贴近 **DeepSeek C 端体验**的聊天客户端：**Web 优先**，服务端负责持有 API Key 并转发流式回复，聊天记录只保存在浏览器本地。

当前版本 **v0.1（M0 Web MVP）**：可以完成「新建对话 → 输入文本 → 服务端转发 DeepSeek → SSE 流式渲染 → 本地持久化」的完整链路。

| 深色 · 空态 | 深色 · 对话 |
| --- | --- |
| ![home dark](docs/screenshots/home-dark.png) | ![chat dark](docs/screenshots/chat-dark.png) |

| 深度思考 | 浅色主题 |
| --- | --- |
| ![thinking](docs/screenshots/thinking-dark.png) | ![chat light](docs/screenshots/chat-light.png) |

## 架构

```text
┌──────────────────────────────┐        POST /api/chat (SSE)        ┌───────────────────────┐
│  Browser / WebView           │ ─────────────────────────────────> │  Dream Server (Hono)  │
│  React 18 + Vite + TS        │ <───────────────────────────────── │  Node + tsx           │
│                              │         streamed SSE chunks        │  :8787                │
│  IndexedDB "dream"           │                                    │  .env API Key         │
│  （会话 / 消息 / 设置）       │                                    └───────────┬───────────┘
└──────────────────────────────┘                                                │ HTTPS
                                                                                v
                                                                     api.deepseek.com
```

- **API Key 只存在于服务端** `.env`，前端代码和浏览器存储里都没有 Key。
- **聊天内容不落服务端**：服务端只做校验、转发和流式透传；会话与消息保存在浏览器 IndexedDB。
- 浏览器 → 服务端 → DeepSeek 的文本请求与 SSE 响应都经过本地服务端，后续可在这一层加登录、单设备校验、限流与配额。

## 技术栈

| 层 | 选型 |
| --- | --- |
| Web | React 18.3、TypeScript 5.9、Vite 7、`idb` 8 |
| Markdown | `react-markdown` 10、`remark-gfm` 4、`rehype-highlight` 7 |
| 服务端 | Node 22+（开发用 26）、Hono 4、`@hono/node-server`、tsx |
| 存储 | 浏览器 IndexedDB（库名 `dream`）；服务端暂无数据库 |
| 后续 Android | Capacitor 包同一套 Web 产物（未开始） |

## 快速开始

要求：Node.js ≥ 20，包管理器 pnpm 或 npm。

```bash
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY=sk-...

# 任选其一安装
pnpm install
# 或：npm install

# 一条命令同时起服务端（8787）和 Web（5173）
pnpm dev
# 或：npm run dev
```

打开 <http://localhost:5173>。

没有 API Key 也想先看 UI 和流式链路？用本地模拟模式：

```bash
DREAM_MOCK=1 pnpm dev
```

模拟回复由 `apps/server/src/mock.ts` 生成，不会请求 DeepSeek，也不会消耗 Token。

## 目录结构

```text
apps/
  server/                 # 本地转发服务
    src/index.ts          # Hono 路由：/api/health、/api/chat
    src/deepseek.ts       # 请求校验 + 上游 SSE 透传 + 中断传播
    src/mock.ts           # 无 Key 时的本地模拟流
    src/config.ts         # .env 加载与配置
  web/                    # Web 客户端
    src/App.tsx           # 应用外壳、主题、侧边栏状态
    src/hooks/useChat.ts  # 会话/消息状态机、流式累积、持久化
    src/lib/api.ts        # SSE 客户端解析
    src/lib/db.ts         # IndexedDB（idb）
    src/components/       # Sidebar / ChatView / MessageList / Composer / Markdown
    src/styles/           # 设计 token 与布局（对齐实测 DeepSeek 视觉）
docs/
  feature-teardown.md     # DeepSeek C 端功能拆解、优先级与实现规格
  screenshots/            # 界面截图
scripts/dev.mjs           # 同时启动 web + server 的开发脚本
```

## 已实现（M0）

- 会话列表：新建、切换、删除，首条用户消息自动生成标题（超长截断）
- 流式对话：SSE 逐块追加渲染；发送中显示「停止生成」，客户端中断会同步中止上游请求
- 多轮上下文：回传历史用户消息与已完成助手消息（错误消息与空回复不进入上下文）
- 深度思考：开关后请求 reasoner 模型，渲染 `reasoning_content` 为默认折叠的思考块
- 消息渲染：Markdown、GFM 表格、代码块高亮、语言标签、一键复制、链接新窗口打开
- 本地持久化：会话/消息存 IndexedDB；刷新后自动恢复上次打开的会话；主题偏好存 localStorage
- 错误处理：未配置 Key、上游鉴权失败、网络失败会在消息内展示可读错误
- 界面：深/浅色主题、桌面/移动端响应式侧边栏、空态、健康状态提示条
- 服务端：请求校验（条数/长度/角色）、SSE 头、AbortSignal 传播、错误信息透出

## 服务端接口

### `GET /api/health`

```json
{ "ok": true, "mock": false, "model": "deepseek-chat", "hasKey": true }
```

### `POST /api/chat`

请求：

```json
{
  "messages": [{ "role": "user", "content": "你好" }],
  "thinking": false
}
```

响应：`text/event-stream`，按 DeepSeek Chat Completions 的 SSE 格式逐块返回；`thinking: true` 时改用 `DREAM_REASONER_MODEL`，思考内容出现在 `delta.reasoning_content`。

## 配置项

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 平台 Key，只在服务端读取 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 上游地址 |
| `DREAM_MODEL` | `deepseek-chat` | 普通对话模型 |
| `DREAM_REASONER_MODEL` | `deepseek-reasoner` | 深度思考模型 |
| `DREAM_MOCK` | `0` | `1` 时启用本地模拟流 |
| `PORT` | `8787` | 服务端端口 |

> 如果账号侧模型名发生变化（例如只提供 `deepseek-flash`），修改 `DREAM_MODEL` / `DREAM_REASONER_MODEL` 即可，无需改代码。

## 本地数据

- IndexedDB 库名 `dream`，v1：
  - `conversations`：`{ id, title, createdAt, updatedAt }`，索引 `by-updated`
  - `messages`：`{ id, conversationId, role, content, reasoning?, status, error?, createdAt }`，索引 `by-conversation`、`by-created`
- `localStorage`：
  - `dream-theme`：`dark` / `light`
  - `dream-active-id`：上次打开的会话 id

清空数据：浏览器 DevTools → Application → IndexedDB → 删除 `dream`。

## 尚未实现（下一步）

- 登录、单一设备会话、用户管理后台（服务端当前无鉴权，请勿直接暴露公网）
- 智能搜索 / 阅读链接 / 文件上传与解析 / 图片理解（DeepSeek 服务端工具）
- 重新生成、编辑消息、消息分支、继续生成
- 语音输入 / 朗读、KaTeX、Mermaid、导入导出 DeepSeek ZIP
- Android（Capacitor）打包、PWA
- 设置页（语言、所在地、数据管理）

优先级与交互规格见 [docs/feature-teardown.md](docs/feature-teardown.md)。

## Roadmap

| 阶段 | 内容 |
| --- | --- |
| M0 ✅ | Web 骨架、流式聊天、本地持久化、深度思考、主题与响应式 |
| M1 | 服务端登录（JWT）+ `device_id` 单设备会话 + 用户/设备管理 + 限流 |
| M2 | 重新生成 / 编辑 / 分支 / 继续生成、会话搜索、设置页 |
| M3 | 智能搜索、阅读链接、文件上传与解析、引用渲染 |
| M4 | Capacitor Android 壳、录音权限、TTS、返回键与安全区 |
| M5 | 导入导出、数据管理、用量统计、审计 |

## 已知限制

- **真实 DeepSeek API 尚未联调**（本机没有 Key）：链路已按官方 Chat Completions SSE 格式实现，填入 Key 后即可验证；如遇模型名或参数差异，改环境变量或 `apps/server/src/deepseek.ts`。
- 只支持纯文本请求；消息里的 Markdown 只做展示，不参与多模态。
- 停止生成会保留已生成的部分内容，暂不支持「继续生成」。
- 单进程单密钥，无多租户配额；上线前必须补鉴权与限流。
- pnpm 在「home 目录只读」的沙箱里可能因 store 锁失败，此时用 `npm install`（仓库已配置 npm workspaces）即可。

## 开发脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动 server + web |
| `npm run dev:server` | 只启动服务端（tsx watch） |
| `npm run dev:web` | 只启动 Web（vite） |
| `npm run build` | 类型检查 + 构建 Web |
| `npm run typecheck` | 两个 workspace 的类型检查 |
| `npm run start` | 以 tsx 启动服务端（无 watch） |

## 安全说明

- `.env` 已在 `.gitignore` 中，不要提交 Key。
- 服务端 CORS 当前对 `/api/*` 全开，仅适合本地开发；部署时收紧到实际域名并加鉴权。
- 聊天内容默认只在用户浏览器本地；服务端日志只记录请求条数与状态，不记录消息正文。

## License 与声明

MIT（见 [LICENSE](LICENSE)）。本项目是非官方实现，仅用于学习与技术验证；DeepSeek 名称与商标归其所有者。界面尺寸、配色与文案参考 DeepSeek 官方 Web 端与 MIT 开源的 `chat-demo` 实测，以便保持体验一致。
