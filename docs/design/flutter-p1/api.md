# API 契约（Flutter P1 复用）

来源：`apps/web/src/lib/api.ts`、`cloudSync.ts`、`crypto.ts`、`auth.ts`、`device.ts`、`types.ts`、`backup.ts`，服务端 `apps/server/src/index.ts`（backup 路由）。

## 通用
- 错误体统一 `{ error: { code?, hex?, message?, requestId? } }`。
- 鉴权头 `authorization: Bearer <token>`（小写键）。
- 普通 JSON 请求：`content-type: application/json`、`accept: application/json` + auth 头，15s 超时；feedback/cloud 30s。
- 大请求 gzip：JSON 后 text.length ≥ `256*1024` 时 body gzip + `content-encoding: gzip`（仅 chat / context/warm）。Flutter 用 `gzip` 包或 `dart:io` 实现 gzip（需自行实现，无 CompressionStream）。

## 端点
### 认证
- `POST /api/v1/auth/register` `{username,password,displayName?,deviceId,deviceName,platform}` → `AuthResult`
- `POST /api/v1/auth/login` `{username,password,deviceId,deviceName,platform}` → `AuthResult`
- `GET /api/v1/me` → `{user: AuthUser}`
- `POST /api/v1/auth/logout` → `{ok}`（失败静默）
- `AuthResult = {token:string, user:AuthUser}`；`AuthUser = {id,username,displayName:null|string,createdAt,customerNo?,isAdmin?}`

### 聊天
- `POST /api/v1/chat`：SSE（见下）。

### 文件 / 反馈 / 导入
- `POST /api/v1/files` multipart 字段 `file` → 201 `FileAttachment`；失败 code `UPLOAD_FAILED`
- `DELETE /api/v1/files/:id`
- `GET /api/v1/files` → `{files: FileAttachment[]}`
- `GET /api/v1/import/share?url=<encodeURIComponent(url)>` → `SharedChatResponse`
- `POST /api/v1/feedback` multipart：`platform`("web"|"app")、`os`、`osVersion`、`appVersion`、`description`、`reproducible`("always"|"sometimes"|"once"|"unknown")、`screenshot?` → `{report}`
- `POST /api/v1/context/warm` `{messages}`（可 gzip）
- `POST /api/v1/import/archive` `{url, skipIds:string[]}` → NDJSON 流
- `FileAttachment = {id,name,bytes,chars,createdAt,preview?}`（preview = content 前 200 字）
- `SharedChatMessage = {role:"user"|"assistant",content,reasoning,status:"done"|"error",createdAt(ms)}`
- `SharedChatResponse = {shareId,title,attachments,messages[]}`

## 聊天 SSE
请求头 `content-type: application/json`、`accept: text/event-stream`、`authorization: Bearer <token>`（可选 gzip）。
请求体：
```
{ messages: [{role:"user"|"assistant",content}], thinking: bool, files?: string[], webSearch?: bool }
```
解析：块 `\n\n` 分隔（`\r\n`→`\n`）；`:` 行忽略；`event:` 取事件名；`data:` 取 JSON（去行首 1 空格）；多 data 行 join `\n`。未知事件忽略。

事件：
| 事件 | data 字段 |
|---|---|
| `start` | `{requestId,model,thinking,createdAt}` |
| `thinking` | `{delta:string}` → onReasoning |
| `delta` | `{delta:string}` → onDelta |
| `sources` | `{sources: SearchSource[]}` |
| `refusal` | `{message:string}`（按正常回复展示）|
| `done` | `{requestId,finishReason:"stop"\|"length"\|"content_filter"\|"unknown",createdAt}` |
| `error` | `{error:{code?,hex?,message?,requestId?}}` → ChatApiError（默认 UPSTREAM_ERROR, status 0）|

`SearchSource = {index,title,url,siteName?,icon?}`

## 客户端错误码（ChatApiError）
| code | hex | message 模板 |
|---|---|---|
| NETWORK | `0x0001` | `网络连接失败，请检查网络后重试。` |
| ABORTED | `0x0002` | （预留，未实际抛出）|
| INVALID_RESPONSE | `0x0003` | `服务端返回了非流式响应` |
| NO_STREAM_SUPPORT | `0x0004` | `当前浏览器不支持流式响应` |
| TIMEOUT | `0x0005` | `请求超时，请检查网络后重试。` |
| HTTP_ERROR | `0x5000` | 服务端 error.message ?? `请求失败（HTTP ${status}）` |
| UNKNOWN | `0x5001` | 默认兜底 |

`message = \`${hex} ${message}${requestId ? \`（请求编号 ${requestId}）\` : ""}\``；字段 status/code/hex/requestId?。

## 裁剪重试（对齐 web api.ts:296-388）
- `trimMessagesForRetry`：从尾向前保留 ≤24 条 且 ≤80000 字符（首条不判字符）；保留后裁到首个 `role==="user"` 之后。
- 发送前 `totalChars > 800_000` 先 trim。
- 重试（仅一次，未收到任何输出时）：413 / PAYLOAD_TOO_LARGE / (status 0 且 NETWORK|TIMEOUT) / TypeError / message 含 `failed to fetch|load failed|network|input stream|stream closed`。

## 云备份
### meta
`GET /api/v1/backup/meta` →
```
{ key, legacyKey?, backup:
    {size,updatedAt,iv,version:2,payload?}   // 流式；payload 仅当 size≤1MiB 内联 "dream1.<iv>.<base64>"
  | {size,updatedAt,legacy:true,payload}     // 旧 base64
  | null }
```

### stream
- `GET /api/v1/backup/stream`：`content-type: application/octet-stream`、`content-length`、`x-backup-iv`(base64)、`x-backup-encoding`(gzip)、`cache-control: no-store`；body=加密压缩字节。无流式 404。
- `PUT /api/v1/backup/stream`：头 `content-type: application/octet-stream`、`x-backup-iv`(base64, 服务端校验 12B)、`x-backup-encoding: gzip`；body=`encrypt(gzip(json))` 密文字节。响应 `{ok,updatedAt,size}`。415 非 octet；400 IV 非 12B；413 >20MiB。

### legacy
- `GET /api/v1/backup` → `{key,legacyKey?,backup:{payload,updatedAt,size}|null}`
- `PUT /api/v1/backup` body `{payload,updatedAt?}`（空 400，超限 413）

### 数据格式
- payload 解码：`split(".")` → `[tag,iv,data]`，tag 必须 `dream1`。
- **dream-backup v2**（云端）：`{format:"dream-backup",version:2,exportedAt,conversations[],messages[],tombstones?[],sessions?[]}`
- **dream-export v1**（手动导出信封）：`{format:"dream-export",version:1,exportedAt,encrypted,algorithm?:"AES-GCM",compression?:"gzip",iv?,data?,backup?}`
- AES-GCM：IV 12B base64；key = `SHA-256(sessionKey)` → raw key AES-GCM(256-bit)；sessionKey = `info.key`（/backup/meta）；GCM 16B tag 自动附在 cipher 末尾。
- 20MiB：push 前 raw > 20MiB 或 cipher > 20MiB 抛错；服务端 content-length > 20MiB → 413。

### legacy 回退
- `fetchCloudInfo`：`GET /backup/meta`，404/405 才回退 `GET /backup`。
- 密钥迁移：`legacyKey` 存在且本地 key ≠ info.key → 用 legacyKey 解密本地 → migrate → pull 旧云 → rekey 新 key → push → 写回新 key。

## 认证与 token 存储（Flutter 映射）
- 头：`authorization: Bearer ${token}`；无 token 不加。
- 存 `flutter_secure_storage`：`dream-token`、`dream-user`（JSON）、`dream-device-id`（uuid 或 `dev-<ts>-<rand>`）、`dream-encryption-key`（=sessionKey）、`dream-local-owner`。
- 云节流键（shared_preferences）：`dream-cloud-last-push`、`dream-backup-rev`、`dream-cloud-upload-declined`/`-pending`。
