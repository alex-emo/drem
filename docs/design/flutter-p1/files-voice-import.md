# 文件 / 语音 / 导入 / 更新契约

来源：`apps/server/src/{files,asr,realtimeAsr,archiveImport,share,release}.ts`、`apps/mobile/src/services/**`。鉴权 `Authorization: Bearer <token>`（WS 除外）。

## A. 文件上传
- `POST /api/v1/files`（兼容 `/anthropic/v1/files`）：multipart 字段 `file`（非 base64 JSON）。`/anthropic/v1/files` 额外 `purpose` 字段。
- 限长：`MAX_FILE_BYTES = 1MiB`、`MAX_FILE_CHARS = 2_000_000`；bodyLimit = 1MiB+512KiB；>1MiB → 413。
- 响应 201：`{id,name,bytes,chars,createdAt,preview}`（preview=content 前 200 字；name 截 200）。id = `file_`+20hex（uuid 去 `-` 前 20）。
- 解析：docx → unzip `word/document.xml`（uncompressedSize>20MiB 拒）；doc/pdf/ppt/pptx/xlsx → 400「暂不支持 .xxx 格式」；其余文本 UTF-8→GBK→UTF-16(BOM)；>2M 字符 413。
- 聊天引用：请求体 `files:string[]`，注入最后一轮 user 前，包 `<file name="...">…</file>`；MAX_CHAT_FILES=8、MAX_CHAT_FILE_TOKENS=12000、单文件 3000 token。
- `GET /api/v1/files` → `{files[]}`；`DELETE /api/v1/files/:id`。

## B. 语音 ASR
### HTTP `POST /api/v1/tools/asr`
- Content-Type：multipart(`file`) 或裸 `audio/wav|audio/x-wav|audio/wave|application/octet-stream`。
- WAV 校验：RIFF/WAVE、PCM(audioFormat=1)、单声道、16kHz、16-bit；1MiB / 120s。
- 响应 `{text,durationSeconds}`。错误码：400 ASR_AUDIO_INVALID、413 ASR_AUDIO_TOO_LARGE(size|duration)、415、429、499、502、503 ASR_NOT_CONFIGURED、504。

### WS `GET /api/v1/asr/ws`
- 子协议 `Sec-WebSocket-Protocol: dream.asr, <token>`；服务端回 `dream.asr`。
- 帧：raw PCM 16kHz 单声道 16-bit 小端；2MiB / 90s；发 `finish` 后 12s 强制结束。
- 客户端→服务端：`{"type":"finish"}`、`{"type":"cancel"}`。
- 服务端→客户端：`{type:"ready"}`、`{type:"partial",text}`（增量累积全文）、`{type:"final",text}`、`{type:"error",message}`。
- 关闭码：1000 done/cancelled、1009 too large/timeout、1011 upstream、1013 no key。

## C. APK 更新
- `GET /api/v1/release`（别名 `/version`）→ `{version,versionCode,sha256,size,apkUrl,notes,publishedAt}`；无 APK 404。
- `apkUrl = ${publicOrigin}/download/dream-android.apk?v=${version}&h=${sha256.slice(0,12)}&t=${now}`。
- Flutter：版本比较（语义化）→ 下载 → sha256 校验 → 调系统安装（Android 用 FileProvider / ACTION_VIEW；插件缺则回退浏览器下载）。

## D. 分享 / ZIP 导入
### 分享 `GET /api/v1/import/share?url=<链接或纯id>`
- `parseShareId`：纯 id `[A-Za-z0-9_-]{16,64}` 或 `https://chat.deepseek.com/share/<id>`。
- 响应 `SharedChat{shareId,title,attachments,messages:[{role,content,reasoning,status:"done"|"error",createdAt(ms)}]}`。
- 会话 id=`ds-share-<shareId>`，消息 id=`ds-share-<shareId>-<idx+1>`，reasoning→thinking 块。

### 归档 `POST /api/v1/import/archive`
- 请求 `{url, skipIds?:string[]}`（skipIds 元素 `ds-<sessionId>`）。
- URL 必须 https 且 hostname 匹配 `/(^|\.)myhuaweicloud\.com$/i`；MAX_REDIRECTS=5 逐跳重校验；300MiB。
- 响应 NDJSON 流（application/x-ndjson）：`{"type":"conversation",...}`、`{"type":"messages",...}`（每批≤200）、`{"type":"warning"}`、`{"type":"done","stats":{...}}`、`{"type":"error",...}`。
- ZIP：`manifest.json`（`export_format_version` 必须=3）、`chat_sessions/<sessionId>.json`。
- manifest v3 会话：`{id,title,current_message_id,inserted_at,updated_at,messages:[{id,parent_id,role:"USER"|"ASSISTANT",status,inserted_at,fragments:[{type,content?,files?}]}]}`。
- current_message 沿 parent_id 回溯；fragment：REQUEST→user、RESPONSE/TEMPLATE_RESPONSE→assistant 正文、THINK→reasoning、FILE→附件；status∈{FAILED,TIMEOUT,CONTEXT_LENGTH_EXCEEDED}→error。
- 生成 id：会话 `ds-<session.id>`、消息 `ds-<session.id>-<message.id>`。

## E. 移动端存储语义（旧 IndexedDB，供 Flutter 对齐，非直接照搬）
- 旧库 `chat-demo` DB_VERSION=11，5 表 sessions/sessionSummaries/files/sessionsStaging/filesStaging。
- `FileAttachment{id,serverId:null|string,name,size,isImage,mimeType}`；`UserMessage{id,role:'user',content,files,createdAt,parentId?,selectedChildId?,excludeFromContext?}`；`AssistantMessage{id,role:'assistant',createdAt,model,thinking?,search?,status:'pending'|'streaming'|'done'|'stopped'|'error',blocks:[{type:'thinking'|'text'}],error?}`。
- staging + commitStaging：导入写 staging，commitStaging 单事务原子替换，失败回滚。
- 加密落盘：AES-GCM，key=SHA-256(sessionKey)，`encryptText` 返回 `base64(iv).base64(cipher)`，iv 12B。
- 上传客户端：`uploadFile` 走 `/anthropic/v1/files`，purpose 图片=null、pdf/doc/docx/ppt/pptx=`rich_layout_recognition`、其余 `user_data`；1MiB、50 个、并发 3；file_id 正则 `file-api-[\w-]+`；失效重传 FILE_RETRY_LIMIT=2 退避 1000*2^n。
