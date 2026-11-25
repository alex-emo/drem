# 04 · 子代理计划

## 1. 拆分原则

- 按 **disjoint write scopes** 拆（见 03 的文件边界），避免写冲突。
- 设计系统先行；依赖 `chat-shell` 的组件先定接口再并行。
- Lead 负责：文档、集成、`lib/app/**`、最终 analyze/test、提交。

## 2. 任务

### T1 · design-system（无依赖）

- 范围：`lib/design/**`、`lib/shared/widgets/**`
- 内容：补齐 tokens（success/warning/danger 语义、textSecondary 等）、`DreamPalette` 明暗两套、`DreamTheme`、`DreamMark`、`PressableScale`、`ErrorView`。
- 验收：深/浅两套对比度达标；组件示例在 motion-lab 可复用。

### T2 · composer-messages（无依赖，接口已冻结）

- 范围：`lib/features/chat/widgets/{composer,message_list,message_bubble,chat_message}.dart`
- 内容：按 03 的 API 实现；多行增高、发送清空、附件 P1 占位、流式光标、错误横幅。
- 验收：单测覆盖多行、canSend 翻转、错误态。

### T3 · settings-motion（无依赖）

- 范围：`lib/features/settings/**`、`lib/features/motion/**`
- 内容：设置页（主题切换、版本）、动效实验室（按压/气泡/弹层/错误态预览，引用 T1/T2 组件）。
- 验收：主题切换持久化；motion-lab 各预览可触发。

### T4 · chat-shell（依赖 T1+T2）

- 范围：`lib/features/chat/presentation/**`、`lib/features/chat/widgets/empty_state.dart`
- 内容：ChatScreen 组合 ChatTopBar + ChatEmptyState/MessageList + Composer；空态 4 条编号建议；发送走 P0（本地提示，不接 SSE）。
- 验收：空态→输入→（P0）反馈链路；路由可达。

## 3. 顺序

```text
Phase 1:  T1 · T2 · T3 并行（disjoint）
Phase 2:  T4（等 T1+T2）
Phase 3:  Lead 集成：路由/主题/空态数据接线，跑 analyze + 全量 test
Phase 4:  Lead commit + push（不部署）
```

## 4. 子代理协作

- 每个子代理开工前读：本目录 README、00、01、02、03，以及自己 owner 的组件规格。
- 用 Team 共享 task 板跟踪；完成后 `send_message` 给 lead 报告并 complete。
- 交叉引用只通过冻结 API；发现 API 不够用先报告 Lead，不擅自改 03。

## 5. Definition of Done（整个 P0）

- `flutter analyze` 0 issue
- `flutter test` 全绿
- 空态 → 输入 → 发送（P0 反馈）→ 主题切换 → 动效实验室 全部可达
- 深/浅/减少动效/大字号 不崩不截断关键操作
- 分支已提交推送，master 未动，未部署
