# 组件规格 · Message List / Bubble（消息列表）

Owner: composer-messages

## 1. 目标

安静地呈现对话：用户内容收进低饱和气泡，助手内容直接排布在画布上，层级靠排版不靠卡片。

## 2. 数据模型

见 03 的 `ChatMessage` / `ChatRole`。P0 只有 `user`/`assistant` 两角色，无思考、无分支。

## 3. MessageList

- `ListView.builder`，`padding` 底部 `bottomPadding`，反向滚动（新消息在底）。
- `empty` 非空时替代列表（由 chat-shell 传 `ChatEmptyState`）。
- 新消息出现：滚到底（`scrollController` 由 shell 持有并传入，或内部自动）。
- 流式期间不整列重建；只更新末尾一条。
- 时间锚点：相邻消息本地日期不同才插 `DayDivider`（今天/昨天/11月20日/2025年11月20日），首条不插、单日零分隔；分隔嵌在该消息 item 内，不单独占 ListView index。精确时分不放列表，留给长按动作条（见 `design-lab/decisions/0002-day-anchors.md`）。

## 4. MessageBubble

- 用户：右对齐、气泡底 `bubbleUser`（dark `#1B2233` / light `#EEF2FE`），圆角 md（14），max 宽 78%。
- 助手：左对齐、无气泡底，正文 bodyLarge 16/1.55，圆角不套。
- 时间/元信息：bodySmall textTertiary，可选。
- 流式：末尾 1.5pt brand 竖条呼吸光标；文本只追加。
- 错误：气泡下方错误横幅（danger）+ 重试按钮，220ms 淡入。
- 进入动画 260ms（见 02）；`entrance=true` 时播，否则静态。

## 5. P1 预留（不实现，只留注释）

- `thinking` 段、引用/来源、分支切换、markdown、代码高亮。
- 不在 P0 造假：没有这些数据就不渲染。

## 6. 验收（单测）

- 用户/助手渲染方式不同；用户有气泡底、助手无。
- `isStreaming` 显示光标；`isError` 显示错误横幅 + 重试回调。
- 空列表 + `empty` 渲染空态；无 `empty` 时不崩溃。
- 减少动效下进入动画直接到位。
