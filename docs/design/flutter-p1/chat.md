# 聊天状态机 / 消息树 / 本地持久化契约

来源：`apps/web/src/hooks/useChat.ts`（839 行）、`apps/web/src/lib/db.ts`、`branches.ts`、`history.ts`、`types.ts`。

## A. 状态机行为（对齐 web useChat）

### sendMessage(raw, {files, webSearch})
- trim 空 或 streaming 中 → return。
- 无 activeId → 建 Conversation{id,title:makeTitle(text),createdAt,updatedAt,rootMessageId:null}，插头，setActiveId。
- parentId = 可见最后一条 id（无则 null）。
- 建 userMessage(status done) + assistantMessage(status streaming, createdAt=now+1)，user.selectedChildId=assistant.id。
- rootId = 当前 root ?? user.id。
- 父 selectedChildId 改为 user.id；可见 = [...visible, user, assistant]。
- history = [...historyFor(visible), {role:'user',content:text}]；requestFiles = options.files 非空 ? : inheritedFiles(visible)（继承分支最近 8 个文件去重）。

### editMessage(messageId, raw)
- previous 必须 role==='user'。parentId = previous.parentId ?? null。
- 新建 user+assistant 复用 parentId；编辑首条（parentId null）换根。
- 可见 = [...before, user, assistant]。

### regenerate(assistantMessageId)
- target 必须 assistant 且有 parentId。
- question(target.parentId) 有 excludeFromContext → 拦截提示。
- 沿 parentId 回溯 path，末位须 user；question.selectedChildId 改新 assistant；可见 = [...before, newAssistant]。

### selectMessageVersion(messageId)
- 换根 → putConversation(rootMessageId)；否则 putMessage(parent) 持久化 selectedChildId。

### stop()
- 先 settleRef('stop')（pending 全并入 content）再 abort。

### removeConversation(id)
- deletedIdsRef.add → deleteConversationData（删会话+消息+写 tombstone）。

### loadConversation(id)
- status==='streaming' 记录 repair 成 'stopped'（防残留卡 UI）；normalizeMessages；preferred 优先 conversation.rootMessageId；changed/repair 回写。

### 流式累积
- onDelta: pending += chunk；首启 30ms interval。
- tick(): 每 tick 从 pending 取 N 字并入 content：N = pending.length>160?8 : >60?6 : 4。
- onReasoning: reasoning += chunk 直接更新（不节流）。
- watchdog: 每 10s 检查，无活动 >90s → abort + finish('error','生成超时，请稍后重试。')。
- settleNow('stop')：pending 全并入 → finish('stopped')。

### 错误处理（runReply catch）
- AbortError → finish('stopped')。
- 401 → 派发登录失效（Flutter: SessionController 置未登录 + 跳登录页）。
- code==='CONTENT_FILTERED' → markBlocked（question+assistant 设 excludeFromContext 并写库）+ 固定文案「这段对话触发了模型的内容安全策略…修改最近几条消息，或新建一个会话再试。」
- 网络正则 `/input stream|stream closed|network|load failed|failed to fetch/i` → `0x0001 网络连接中断，请重试。`；否则 rawFailure。

## B. 消息树模型
- `parentId` 指向父，根为 null。`selectedChildId` = 当前选中子版本。`rootMessageId` = 树根，编辑首条可换根。
- `normalizeMessages`：有树（任一消息有 parentId）→ chronological 排序（createdAt 升序，tie id.localeCompare），rootId=第一个无 parentId 的；无树 → 逐条补 parentId/selectedChildId 链。
- `getVisibleMessages`：从 rootId（无效则第一个无 parentId）沿 selectedChildId 走；缺失回退最早兄弟；seen 防环。
- `buildVersions`：按 parentId 分组 chronological → Map<id,{ids,index}>（用于 1/2 版本切换器）。
- `selectVersion`：parentId===null → 换根；否则改 parent.selectedChildId。

## C. 本地持久化（Flutter 用 sqflite 映射）
表（库 `dream_flutter`）：
- `conversations(id PK, title, createdAt, updatedAt, rootMessageId NULL, encTitle NULL)`
- `messages(id PK, conversationId, role('user'|'assistant'), content, reasoning NULL, status('streaming'|'done'|'refused'|'stopped'|'error'), excludeFromContext, error NULL, errorCode NULL, errorRequestId NULL, webSearch, files JSON, sources JSON, createdAt, parentId NULL, selectedChildId NULL, enc NULL, encReasoning NULL)`
- `tombstones(id PK, deletedAt)`
- 索引：messages(conversationId, createdAt)、conversations(updatedAt)。

字段语义与 web 完全一致。加密：有 sessionKey 时 conversation→encTitle、message→enc/encReasoning（AES-GCM）；解密失败跳过不删。`markBackupDirty`：写 `dream-backup-rev=now` 触发云推送。

## D. 上下文裁剪（historyFor）
- 过滤 excludeFromContext；user 全保留；assistant 仅 status∈{done,refused} 且 content.trim() 非空；映射 `{role,content}`（丢 reasoning）。

## E. 云推送触发（4 入口 + 防抖/节流）
1. 登录后 hadCloudBackup → 3s 延时 push。
2. `dream:backup-dirty`（每次写库）→ 2500ms 防抖 → push。
3. 60s interval → maybePush。
4. 首次上传提示按钮 → push。
- 门：无 key/declined/pending → return；rev<=last 跳过；距上次 <5min 跳过；成功写 `dream-cloud-last-push`。
- pushCloudBackup：gzip → AES-GCM → PUT /backup/stream（octet-stream + x-backup-iv/x-backup-encoding:gzip）；>20MiB 抛错。mergeBackup 按 updatedAt/createdAt + tombstone deletedAt 合并。
