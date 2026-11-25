# 0002 · 时间锚点只按「天」切，精确时间留在动作条里

> 状态：**已采纳并实现** · 日期 2026-11-25 · 影响文件：`apps/mobile_flutter/lib/features/chat/widgets/message_list.dart`、新增 `day_divider.dart`
> 证据：[research/B-chat-patterns.md](../research/B-chat-patterns.md) 第二节（MUI X Chat、Slack、iMessage、腾讯云 IM UIKit）

## 1. 观察

消息之间没有任何时间信息：列表里既没有日期分隔，也没有单条消息的时间。一个跨三天的长会话，看起来是一条连续的时间线；用户无法回答「这是我昨天说的，还是上周说的」。

`Message` 已有 `createdAt`（`lib/core/models.dart:102`，本地 `DateTime`，JSON 存 `millisecondsSinceEpoch`），数据层不需要改。

## 2. 问题

不是「看不到 14:32」，而是**看不到日子在哪儿换了**。在长会话里翻回去找一句话时，用户用的检索线索是「昨天」「上周三」，不是「14:32 还是 14:37」。

## 3. 证据要点

- MUI X Chat Date divider（原文逐字核对过，见 B §来源 8）：
  - 「The date divider appears between messages whose createdAt values fall on different calendar days.」
  - 「The first message in a thread never gets a divider, and single-day conversations render no dividers at all — the component returns nothing rather than an empty rule.」
  - 分隔元素带 `role="separator"`，读屏不会把它当消息内容。
  - 它默认按 **UTC** 日界切分。中文时区会切错（东八区 08:00 前的消息被算进前一天），这是库的实现选择，不是规范。
- Slack（B 级第三方实测）：每天只在当天第一条消息上方插一条；文案是「Today」或「Friday, October 2nd」；分隔条本身还是「Jump to date」的入口。
- iMessage（B 级教程站）：标签用「Today / Yesterday / Mon, Jan 8 / 完整日期」；但逐条精确时间靠「左滑并按住」才出现——这是**反面教材**：隐藏且是唯一途径，违反 HIG 的可发现性要求。Dream 不新增这个手势。
- 腾讯云 IM UIKit（A 级 API 文档，原文逐字核对）：「Defines the interval of adding a time divider among the two messages. Unit: second. Default: 300.」→ 中文 IM SDK 的默认是「相邻两条间隔 >5 分钟就插一条」，按间隔而非按天。

## 4. 思考：为什么 Dream 不照抄 5 分钟

5 分钟阈值解决的是**即时通讯**的问题：两个人你一句我一句，5 分钟没说话通常意味着对话中断、回来是新一轮。此时插一条时间，帮用户恢复上下文。

Dream 是 AI 对话，一轮里包含「思考中 + 流式生成长回答 + 阅读」；5 分钟经常在**同一轮之内**就过去了。照抄的结果是几乎每轮上方都有一条「14:32」，分隔条从锚点退化成噪音，还会带来 B 自己警告的两个副作用：小屏上一屏挤进两三条分隔、`ListView.builder` 频繁插删导致 index 抖动。

主流聊天产品（MUI、Slack、iMessage）的常驻锚点都只按**天**切；精确时间要么 hover、要么点开。Dream 采用同一分层，但把「精确时间」放进已经存在的长按动作条（下一步 P0-3），而不是新造手势。

如果将来真实使用表明「同一天内的定位」确实是问题，再引入高阈值（≥2 小时）的「继续对话」锚点，而不是 5 分钟。先用最简单的规则观察。

## 5. 决定

1. **只在本地日界插入日期分隔**：当前消息与上一条的本地日期不同才插；第一条消息不插；单日会话零分隔。
2. **分隔作为消息 item 的前置子节点**渲染（`Column[if (show) DayDivider, bubble]`），不为分隔单独生成 0 高度 item，避免 ListView index 与 `jumpTo` 落点错位。
3. **文案**（本地时区、24 小时制、不带星期）：
   - 今天 → `今天`
   - 昨天 → `昨天`
   - 同年更早 → `11月20日`
   - 跨年 → `2025年11月20日`
   - 未来日期（时钟漂移）→ 按同年/跨年规则显示日期，不写「明天」。
4. **样式**：`bodySmall`（12.5）、`textTertiary`、居中、上方 20 下方 12、无背景无边框。结构靠留白，不靠线。
5. **无障碍**：外层 `Semantics(label: '对话日期 11月20日', child: ExcludeSemantics(child: Text(...)))`，读屏读到「对话日期」而不是把标签当消息正文。
6. 日期格式化抽成纯函数 `dayAnchorLabel(DateTime date, {required DateTime now})`，可单测；组件 `DayDivider` 只负责样式。

## 6. 备选方案

| 方案 | 内容 | 判定 |
|---|---|---|
| A | 跨天 + 同日 >5 分钟（腾讯云默认） | 否。AI 对话的音符密度不同，会产生过量分隔；需要自适应窗口，复杂度与收益不匹配 |
| B | 跨天 + 同日 >30 分钟（backlog 原稿） | 否。30 分钟是拍出来的数字，没有来源；要么 5 分钟有证据，要么就只按天 |
| C | 只按天切，精确时间进长按动作条 | **采纳** |
| D | 每条消息常驻 HH:mm | 否。每行都出现时间会压过正文，破坏 Quiet Instrument 的「内容优先」 |

## 7. 验收（2026-11-25 执行）

- [x] `dayAnchorLabel` 覆盖今天/昨天/同年/跨年/未来五个分支，纯单测。→ `test/day_divider_test.dart` 5 条
- [x] 跨天两条消息之间出现一条分隔；同日两条不出现；第一条上方永远不出现。→ 同文件「跨天插一条分隔，同日不插，首条不插」
- [x] 分隔不新增 ListView item（`itemCount` 仍等于消息数）。→ 同文件「分隔不新增 ListView item」
- [x] `flutter analyze` 无新增问题；`flutter test` 全绿。→ analyze 仅既有 3 条 info；test **104 passed**（91 + 5 顶栏 + 8 日期）

## 8. 与 B 研究的手势建议不一致之处

B 建议恢复「就地 hint + 设置页手势说明」，并给输入区加常驻麦克风。前者与 `0001` 冲突：0001 的判断是「问题在控件不可见，不在文案」，再贴一次 hint 会重复；后者是真实缺口（语音目前只有长按整行这一条路径），单独立项，不塞进时间锚点这一轮。
