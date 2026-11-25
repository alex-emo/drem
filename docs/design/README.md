# Dream Mobile 设计文档索引

- 状态：v0.1（2026-11-25），P0 骨架已存在，进入组件化重构
- 分支：`feat/flutter-mobile-rewrite`
- 适用范围：`apps/mobile_flutter/`；server / web 首期不动

## 设计命题

**Quiet Instrument（安静的仪器）**：界面像一件精密但安静的工具。内容优先、单一强调色、克制的结构线、可感知但不表演的动效。不复刻 web / DeepSeek 的逐像素视觉，但功能映射保持一一对应。

## 阅读顺序

1. [00-ui-philosophy.md](00-ui-philosophy.md)：设计哲学、案例研究、取舍
2. [01-visual-language.md](01-visual-language.md)：颜色、字体、间距、圆角、布局
3. [02-motion-and-interaction.md](02-motion-and-interaction.md)：时长、曲线、触感、减少动效
4. [03-component-contracts.md](03-component-contracts.md)：组件 API、状态、文件边界
5. [04-subagent-plan.md](04-subagent-plan.md)：子代理任务拆分与验收
6. [05-motion-details.md](05-motion-details.md)：滚动物理、手势阈值、原文摘录与参数决策
7. [06-design-criteria.md](06-design-criteria.md)：简约大方 / 廉价 / 直觉交互 / 非人交互的可操作定义与复核清单
8. [07-optimization-backlog.md](07-optimization-backlog.md)：按 P0/P1/P2 排序的优化清单与验收方式
9. 组件规格：
   - [components/chat-shell.md](components/chat-shell.md)
   - [components/composer.md](components/composer.md)
   - [components/message-list.md](components/message-list.md)
   - [components/settings.md](components/settings.md)
   - [components/motion-lab.md](components/motion-lab.md)

## 权威顺序

1. 本目录文档 + `tools/` 下的 token 代码
2. `apps/mobile_flutter/README.md`
3. 现有实现

文档与实现冲突时，先改文档并说明原因，再改代码；不允许“代码先跑偏、文档后补”。

## 协作规则

- 子代理只写任务 `write_scopes` 内的文件；跨文件改动先在任务里说明。
- 冻结的 widget API 在 [03-component-contracts.md](03-component-contracts.md)，改签名必须先通知 Lead。
- 所有组件必须覆盖：空态、加载/流式、错误、禁用、深色、浅色、减少动效、大字号。
- 禁止在 feature 层硬编码颜色/字号/时长；只用 `lib/design/tokens.dart` 与 `DreamPalette`。
- 不新增第三方依赖；确需新增，先给 Lead 理由与体积影响。
- 每个任务完成前跑：`dart format`、`flutter analyze`、相关 `flutter test`。
- 不部署、不改 `master`、不覆盖 `apps/mobile` 旧壳。

## 组件归属

| 组件 | 目录 | Owner |
|---|---|---|
| 设计系统 | `lib/design/`、`lib/shared/widgets/` | design-system |
| 聊天壳 / 空态 | `lib/features/chat/presentation/` | chat-shell |
| 输入区 | `lib/features/chat/widgets/composer.dart` | composer-messages |
| 消息列表 / 气泡 | `lib/features/chat/widgets/message_list.dart` 等 | composer-messages |
| 设置 | `lib/features/settings/` | settings-motion |
| 动效实验室 | `lib/features/motion/` | settings-motion |
| 集成与验收 | 全仓只读 + Lead 手改 | Lead |
