# Dream App ↔ Server API（v1）

本文档是 Web / Android 客户端与本地 Dream Server 之间的**唯一接口契约**。客户端只依赖这里定义的字段与事件，不直接理解 DeepSeek 上游格式；服务端负责校验、鉴权（M1）、转发以及把上游 SSE 归一化为 Dream 事件。

机器可读版本见 [openapi.yaml](openapi.yaml)。实现代码：`apps/server/src/index.ts` 与 `apps/web/src/lib/api.ts`。

## 1. 基础约定

| 项目 | 约定 |
| --- | --- |
| Base URL | 开发环境 `http://127.0.0.1:8787`，Web 通过 Vite 代理 `/api` 访问 |
| API 前缀 | `/api/v1` |
| 传输 | HTTPS（部署时）；本地开发允许 HTTP |
| 请求/响应体 | JSON，`Content-Type: application/json; charset=utf-8` |
| 流式响应 | `text/event-stream; charset=utf-8`（SSE） |
| 字段命名 | 客户端协议统一 `camelCase`；上游 DeepSeek 的 `snake_case` 由服务端转换 |
| 时间 | ISO-8601 UTC，毫秒精度，例如 `2026-11-18T15:20:00.000Z` |
| 请求追踪 | 客户端可发送 `X-Request-Id`（8–64 位 `[A-Za-z0-9._-]`）；服务端始终在响应头回传 `X-Request-Id`，并写入错误体 |
| API 版本 | 响应头 `X-Api-Version: v1` |
| 字符集 | UTF-8；服务端不接收 BOM |

### 版本策略

- `v1` 内只做**向后兼容的新增**：新增可选字段、新增事件类型、新增端点。
- 客户端必须忽略未知字段、未知 SSE 事件与 `:` 开头的注释行。
- 删除/改名/语义变化一律升级到 `/api/v2`，旧版本至少保留一个里程碑。

### 鉴权（v0.3 起）

除 `/api/v1/health`、`/api/v1/models` 外，所有端点要求：

```http
Authorization: Bearer <access_token>
```

未携带或无效返回 `401 UNAUTHORIZED`。注册接口为 `POST /api/v1/auth/register`（开放注册）。单设备踢下线与 `SESSION_REVOKED` 仍属 M1 规划。

## 2. 错误模型

所有非流式错误响应使用统一结构（SSE 建立**之后**的错误改走 `event: error`，见 §3）：

```json
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "messages 不能为空",
    "requestId": "req_9f1c...",
    "details": [{ "field": "messages", "reason": "required" }]
  }
}
```

- `message` 面向用户/开发者可读，可直接展示。
- `code` 稳定可编程判断；客户端不要匹配 `message` 文案。
- `details` 可选，字段级定位。
- HTTP 状态码与 `code` 的对应关系固定，见下表。

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `INVALID_ARGUMENT` | 请求体不是 JSON、字段缺失/越界、最后一条不是 user |
| 401 | `UNAUTHORIZED` | 未登录 / token 无效（M1） |
| 401 | `SESSION_REVOKED` | 单设备策略下被新登录踢下线（M1） |
| 403 | `FORBIDDEN` | 无权限（M1） |
| 404 | `NOT_FOUND` | 路径不存在 |
| 405 | `METHOD_NOT_ALLOWED` | 方法不允许 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 8 MiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` 不是 `application/json` |
| 429 | `RATE_LIMITED` | 触发限流（M1） |
| 500 | `INTERNAL` | 服务端内部错误 |
| 502 | `UPSTREAM_AUTH_FAILED` | DeepSeek 鉴权失败（服务端 Key 无效） |
| 502 | `UPSTREAM_ERROR` | DeepSeek 返回非 2xx 或无法连接 |
| 503 | `UPSTREAM_NOT_CONFIGURED` | 服务端未配置当前供应商的 API Key |
| 504 | `UPSTREAM_TIMEOUT` | 上游超时（预留） |

> 499 `REQUEST_ABORTED` 仅用于服务端日志：客户端已断开，通常收不到响应。

内容安全拒绝：上游返回内容安全错误（如 Qwen `DataInspectionFailed`）时，不向客户端返回 422/502，而是按 DeepSeek 客户端的行为返回 200 + 固定拒绝答复：

```text
event: start
data: {...}

event: refusal
data: {"requestId":"req_...","model":"dream","message":"你好，这个问题我暂时无法回答，让我们换个话题再聊聊吧。"}

event: done
data: {"requestId":"req_...","finishReason":"content_filter","createdAt":"..."}
```

该轮计入 `moderation_events`（不记录聊天正文），不影响后续对话；客户端把 `message` 作为普通助手回复展示，`finishReason` 为 `content_filter`。

## 3. `POST /api/v1/chat`

发起一次流式对话。**一次请求 = 一次生成**，无服务端会话状态；历史由客户端在 `messages` 中回传。

### 请求

```http
POST /api/v1/chat HTTP/1.1
Host: 127.0.0.1:8787
Content-Type: application/json
Accept: text/event-stream
X-Request-Id: req_demo_001
```

```json
{
  "messages": [
    { "role": "user", "content": "用一句话解释 CAP 定理" }
  ],
  "thinking": false
}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `messages` | `Message[]` | 是 | 1–10000 条；按时间正序；最后一条必须是 `user` |
| `messages[].role` | `"system" \| "user" \| "assistant"` | 是 | — |
| `messages[].content` | `string` | 是 | trim 后非空；单条 ≤ 200,000 字符 |
| `thinking` | `boolean` | 否 | 默认 `false`；`true` 时使用 `DREAM_REASONER_MODEL`，返回 `thinking` 事件 |

- 请求体（含全部消息）≤ **8 MiB**。
- 未知字段忽略（便于客户端灰度）。
- 本端点幂等性为 **no**：重复请求会产生新生成。

### 成功响应（200）

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
X-Request-Id: req_demo_001
X-Api-Version: v1
```

SSE 事件序列（严格顺序）：

```text
event: start
data: {"requestId":"req_demo_001","model":"deepseek-chat","thinking":false,"createdAt":"2026-11-18T15:20:00.000Z"}

event: thinking
data: {"delta":"用户想知道 CAP。"}

event: delta
data: {"delta":"CAP 定理指"}

event: done
data: {"requestId":"req_demo_001","finishReason":"stop","createdAt":"2026-11-18T15:20:04.120Z"}
```

| 事件 | 次数 | data 字段 | 说明 |
| --- | --- | --- | --- |
| `start` | 1 | `requestId`, `model`, `thinking`, `createdAt` | 连接建立后立即发送；`model` 为对外展示名 `dream` / `dream-thinking`，真实上游模型只在 health/admin 中可见 |
| `thinking` | 0+ | `delta` | 思考增量；仅在 `thinking: true` 时出现 |
| `delta` | 0+ | `delta` | 正文增量 |
| `refusal` | 0–1 | `requestId`, `model`, `message` | 内容安全拒绝；出现时随后必有 `done`（`finishReason:"content_filter"`），无 `delta` |
| `done` | 1 | `requestId`, `finishReason`, `createdAt` | 终止事件；`finishReason`: `stop` / `length` / `content_filter` / `unknown` |
| `error` | 0–1 | `error: { code, message, requestId }` | 流建立后发生错误；出现即代表本次生成失败，且之后不再有 `done` |

SSE 编码规则：

- 每个事件以空行结束；`data:` 只有一行 JSON（JSON 内的换行已被转义）。
- 以 `:` 开头的行是注释（如心跳），客户端必须忽略。
- 事件名缺失时按 `message` 处理并忽略（前向兼容）。
- 不支持 `Last-Event-ID` 断线重传；连接中断时客户端应重新发起请求（是否重试由业务决定）。
- 客户端 `AbortController` 断开后，服务端同步中止上游模型请求。
- 服务端对 `thinking`/`delta` 做伪流式节拍（约 32ms 一片，按 backlog 自适应速度）；`done` 只会在所有文本出完后发送，客户端无需额外平滑。
- `thinking` 会先完整接收上游思考、脱敏后按节拍下发，因此可能比正文更晚开始出现。

### curl 示例

```bash
curl -N -X POST http://127.0.0.1:8787/api/v1/chat \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -d '{"messages":[{"role":"user","content":"你好"}],"thinking":false}'
```

### 客户端处理建议

1. 校验 HTTP 状态：非 2xx 解析统一错误体并展示 `message`。
2. 逐块解析 SSE，按事件名分发；未知事件忽略。
3. 收到 `done` 结束本次流并保存消息；收到 `error` 记为失败并展示 `message`。
4. 用户点「停止」时 abort 请求；已收到的增量照常保存。

### 3.1 模型身份

服务端会在每次转发前注入固定的 system prompt，并移除客户端自带的冲突身份提示：

- 对外身份统一为 **Dream 模型 / Dream 团队**。
- 不向终端用户暴露 Qwen、通义千问、阿里云、DeepSeek、深度求索等底层模型或供应商名称。
- 客户端不需要、也不应该再自行注入厂商身份提示；即使传入，服务端也会过滤。

## 4. `GET /api/v1/health`

服务存活与能力探测，匿名可访问。

```json
{
  "status": "ok",
  "apiVersion": "v1",
  "serverVersion": "0.2.0",
  "serverTime": "2026-11-18T15:20:00.000Z",
  "mock": false,
  "provider": "qwen",
  "providerLabel": "Qwen",
  "hasApiKey": true,
  "models": {
    "default": "qwen3.7-flash",
    "reasoner": "qwen3.7-flash"
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `status` | `ok`：可正常调用上游；`degraded`：模拟模式或缺少 Key |
| `mock` | `true` 时 `/chat` 返回本地模拟流，不消耗 Token |
| `provider` | 当前上游供应商：`deepseek` / `qwen` |
| `providerLabel` | 供应商展示名 |
| `hasApiKey` | 服务端是否配置了当前供应商的 Key（Key 永不下发） |
| `models.default` | 普通对话模型 |
| `models.reasoner` | 深度思考模型（Qwen 下与 `default` 相同） |
| `context.compressAfterMessages` | 超过多少条消息开始压缩历史（当前 1000） |
| `context.compressAfterChars` | 超过多少字符开始压缩历史（当前 3000000） |

客户端 UI 规则：`status=degraded && mock` 显示「演示模式」；`status=degraded && !hasApiKey` 显示「缺少 API Key」。

## 4.1 长对话自动压缩

`POST /api/v1/chat` 在转发前检查消息总量：超过 **300 条**或 **60 万字符**时，服务端会把较早的消息按最多 30 万字符一段切分，逐段调用当前模型生成中文摘要，并用一条 `system` 摘要消息替代这些历史；最近 120 条 / 24 万字符保留原文。客户端不会看到摘要消息，也无法感知压缩过程。

- 摘要按“分段内容 SHA-256”缓存在服务端 SQLite `context_summaries` 表；追加新消息不会让旧分段重复计费。
- 流式响应会等摘要完成后才开始，首次长对话请求会明显变慢；之后命中缓存基本无额外耗时。
- 导入历史（ZIP / 分享链接）后，客户端若发现会话超过阈值，会静默调用 warm 接口预生成摘要。

### `POST /api/v1/context/warm`

需要 Bearer。请求体与 `chat` 相同（`messages`，不要求最后一条是 user）。仅生成/缓存摘要，不调用对话补全逻辑。

```json
// 响应
{ "compressed": true, "segments": 7, "cached": 5, "originalMessages": 5123 }
```

## 5. `GET /api/v1/models`

返回服务端配置的模型，供设置页/调试展示。Qwen 模式下返回单个 `{ id: "qwen3.7-flash", thinking: "auto", default: true }`。

```json
{
  "data": [
    { "id": "deepseek-chat", "thinking": false, "default": true },
    { "id": "deepseek-reasoner", "thinking": true, "default": false }
  ],
  "provider": "deepseek"
}
```

## 6. `GET /api/v1/import/share`

需要 `Authorization: Bearer`。由服务端抓取 DeepSeek 分享页数据（浏览器直接请求会被 CORS 拦截），归一化后返回，客户端再写入本地 IndexedDB。

### 查询参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `url` | 是 | 完整分享链接（`https://chat.deepseek.com/share/<id>`）或 16–64 位分享 id |

### 成功响应（200）

```json
{
  "shareId": "n6gxbmxevd26qxjj5a",
  "title": "这期神了",
  "attachments": 15,
  "messages": [
    {
      "role": "user",
      "content": "这期神了",
      "reasoning": "",
      "status": "done",
      "createdAt": 1794896419865
    }
  ]
}
```

- 只保留当前分支：从最后一条消息按 `parent_id` 回溯。
- 用户文本取 `REQUEST` / `TEMPLATE_RESPONSE`，助手文本取 `RESPONSE` / `TEMPLATE_RESPONSE`，`THINK` 归入 `reasoning`。
- 纯附件消息的用户文本为 `"[图片]"`；`attachments` 表示未导入的附件数量。
- `status` 为 `done`；DeepSeek 侧 `FAILED` / `TIMEOUT` / `CONTEXT_LENGTH_EXCEEDED` 映射为 `error`。

### 错误

`400 INVALID_ARGUMENT`（链接格式不对）、`401 UNAUTHORIZED`、`404 NOT_FOUND`（分享不存在或已删除）、`422 INVALID_ARGUMENT`（没有可导入的文字）、`502 UPSTREAM_ERROR`（DeepSeek 不可达或返回异常）。

### curl 示例

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8787/api/v1/import/share?url=https%3A%2F%2Fchat.deepseek.com%2Fshare%2Fn6gxbmxevd26qxjj5a"
```

## 7. 健康检查与错误示例

```bash
# 缺少 Key
curl -s -X POST http://127.0.0.1:8787/api/v1/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

```json
{
  "error": {
    "code": "UPSTREAM_NOT_CONFIGURED",
    "message": "服务端未配置 QWEN_API_KEYS：请在项目根目录创建 .env（参考 .env.example）并重启服务；或设置 DREAM_MOCK=1 使用本地模拟。",
    "requestId": "req_9f1c2a..."
  }
}
```

```bash
# 参数错误
curl -s -X POST http://127.0.0.1:8787/api/v1/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[]}'
```

```json
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "messages 不能为空",
    "requestId": "req_5b7e...",
    "details": [{ "field": "messages", "reason": "至少需要一条消息" }]
  }
}
```

## 8. `GET /api/v1/admin/stats`（管理员）

返回后台看板所需的聚合数据：用户、请求次数、输入/输出 Token、Key 用量与组件状态。需要 Bearer，且用户名在服务端 `DREAM_ADMIN_USERS` 名单内，否则返回 403 `FORBIDDEN`。

```json
{
  "generatedAt": "2026-11-19T07:50:08.000Z",
  "components": {
    "api": "v1", "serverVersion": "0.2.0", "uptimeSeconds": 41,
    "memoryMb": 98, "database": "ok",
    "provider": "qwen", "providerLabel": "Qwen", "model": "qwen3.7-flash",
    "keys": { "total": 5, "available": 5 },
    "lastRequestAt": "2026-11-19T07:50:06.229Z"
  },
  "totals": { "users": 8, "activeSessions": 9, "requests": 21, "promptTokens": 12030, "completionTokens": 8042, "totalTokens": 20072, "moderationEvents": 3, "moderationUsers": 2, "errorEvents": 1 },
  "users": [{ "username": "Alex", "isAdmin": true, "requests": 4, "promptTokens": 900, "completionTokens": 320, "totalTokens": 1220, "lastSeenAt": "...", "moderationCount": 2, "lastModerationAt": "..." }],
  "keys": [{ "id": 1, "available": true, "requests": 5, "promptTokens": 3000, "completionTokens": 1200, "totalTokens": 4200, "lastUsedAt": "..." }],
  "days": [{ "day": "2026-11-19", "requests": 21, "promptTokens": 12030, "completionTokens": 8042, "totalTokens": 20072 }],
  "moderation": [{ "id": 1, "username": "Alex", "requestId": "req_...", "provider": "qwen", "model": "qwen3.7-flash", "stage": "primary", "messageCount": 85, "detail": "DataInspectionFailed: ...", "createdAt": "..." }],
  "errors": [{ "id": 1, "requestId": "req_...", "method": "POST", "path": "/api/v1/chat", "status": 422, "code": "CONTENT_FILTERED", "message": "...", "username": "Alex", "createdAt": "..." }]
}
```

Token 数据来源：每次 `/api/v1/chat` 或上下文摘要请求收到上游 `usage` 后写入 SQLite `usage_events`（按用户与 Key 归因）；没有 usage 的请求按 0 记录，仍计入请求数。

内容拦截：主供应商返回内容安全错误时写入 `moderation_events`（每个调用阶段一条，当前仅 `primary`，不记录聊天正文）；用户表的 `moderationCount` 按 `request_id` 去重，表示触发轮次。`error_events` 记录 `status >= 500`、`RATE_LIMITED` 与所有 `UPSTREAM_*` 错误（内容拒绝走 `moderation_events`，不算错误），并带上请求编号，方便按用户报障时间反查。后台入口为 `https://<域名>/admin`。

## 9. 规划中的端点（M1）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/auth/refresh` | 刷新 access token |
| `DELETE` | `/api/v1/admin/devices/:id` | 踢下线（管理员） |

## 9. 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-11-18 | v1 | 初版：health / models / chat（归一化 SSE）、统一错误体、请求 ID、版本前缀 |
| 2026-11-19 | v1.1 | 注册/登录/登出/me；chat 要求 Bearer |
| 2026-11-19 | v1.2 | 新增 `GET /api/v1/import/share` 分享链接导入 |
| 2026-11-19 | v1.3 | 新增 `DREAM_PROVIDER=qwen`（百炼 Qwen3.7-Flash）；health 增加 provider / providerLabel，models 增加 provider |
| 2026-11-19 | v1.4 | 长对话自动分段摘要（>1000 条或 >300 万字符）；新增 `POST /api/v1/context/warm`；health 增加 context 阈值 |
| 2026-11-19 | v1.5 | 新增管理员看板 `GET /api/v1/admin/stats`（按用户/Key 统计 Token）；`DREAM_ADMIN_USERS` 控制权限 |
| 2026-11-19 | v1.6 | 内容拦截与错误事件落库（`moderation_events` / `error_events`），后台展示用户拦截次数、拦截记录与最近错误；错误响应附带 `requestId` 与可读错误码 |

## 认证（v0.3）

除 `health`、`models` 外，所有 `/api/v1/*` 需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | `{ username, password, displayName?, deviceId? }` → `201 { token, user }` |
| POST | `/api/v1/auth/login` | `{ username, password, deviceId? }` → `{ token, user }` |
| POST | `/api/v1/auth/logout` | 使当前 token 失效 |
| GET | `/api/v1/me` | 当前用户 `{ user }`（含 `isAdmin`） |
| GET | `/api/v1/admin/stats` | 管理员看板统计数据 |

错误码新增：`INVALID_CREDENTIALS`（401）、`USERNAME_TAKEN`（409）、`UNAUTHORIZED`（401）。
