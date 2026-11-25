# 组件规格 · Chat Shell（聊天壳）

Owner: chat-shell · 依赖 T1 + T2

## 1. 目标

把顶栏、空态/消息列表、输入区组合成一个安静的聊天页。P0 不做真实 SSE，发送仅本地反馈。

## 2. 布局

```text
[ safe area ]
ChatTopBar       56pt：左 DreamMark+“Dream”，右设置图标（44pt）
content          弹性，max 780，水平边距 20/28
  ├─ 无消息：ChatEmptyState
  └─ 有消息：MessageList
Composer         贴底 + 安全区；发丝线分隔
```

- 输入聚焦时消息列表自动滚到底；键盘弹起 composer 不跳动。
- 页面切换进入 280ms（见 02）。

## 3. ChatTopBar

- 左：DreamMark（24）+ 文本“Dream”（titleLarge 19/600）。
- 右：设置图标按钮，44pt，tooltip“设置”。
- 无返回键（根页面）；横屏/平板仍单列。
- 品牌蓝仅用于 DreamMark 柔光，不用作顶栏底色。

## 4. 空态

- 主标题 displaySmall（34）：“从一个问题开始。”左对齐。
- 副标题 bodyMedium（textSecondary）一行：“Dream 会记住上下文，回答时可以更具体。”
- 建议 4 条，编号 01–04，左对齐，行间 1px 结构线，点击填入输入框并聚焦：
  1. “解释一下上下文窗口是什么”
  2. “帮我把一段话改得更简洁”
  3. “写一份 7 天健身计划”
  4. “比较两种技术方案的优劣”
- 建议逐条淡入上移，间隔 45ms，仅首屏一次。
- 文案语气克制，不营销；不做卡片。

## 5. 状态

- 空态（无会话消息）
- 有消息（列表 + 输入）
- 输入聚焦 / 失焦
- 发送后（P0：输入清空，snackbar 提示“流式接口将在 P1 接入”）
- 主题深/浅；减少动效；大字号

## 6. 交互

- 点建议 → `onPromptTap(text)` 填入 composer 并 `focusNode.requestFocus()`。
- 发送 → `onSend(text)`：P0 只清空 + 提示，不 append 假消息。
- 附件 → `onAttach`：P1 占位提示，不崩溃。

## 7. 验收

- 空态、顶栏、输入区三者可达；无消息时显示空态。
- 点击建议填入输入框并聚焦。
- 发送按钮在空输入时禁用；有输入时可点。
- 主题切换、减少动效、大字号不崩。
