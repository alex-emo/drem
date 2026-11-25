# 0003 · 浅色主题的第三级文字太淡，读不出来

- 日期：2026-11-25
- 状态：已实施
- 触发：第一次真实截图核对（`design-lab/shots/chat-light-2026-11-25.jpg`）

## 1. 观察

浅色主题下，时间分隔「昨天 / 今天」、输入框提示「轻点输入，长按说话」、附件面板的说明文字都用 `textTertiary`（原 `#858992`）。在 430pt 宽度、1x 截图里能看清，但把屏幕亮度调低、或在户外光下，它们会先于正文消失——这不是审美问题，是读不出来。

## 2. 测量

用 WCAG 2.1 相对亮度公式计算（脚本见会话记录，色值为 sRGB）：

| 前景 | 背景 | 对比度 | AA（正文 4.5:1） |
|---|---|---|---|
| `#858992`（旧） | `#FCFCFD` 页面 | **3.42:1** | 不通过 |
| `#858992`（旧） | `#FFFFFF` 输入区 | 3.51:1 | 不通过 |
| `#6C7079`（新） | `#FCFCFD` 页面 | **4.84:1** | 通过 |
| `#6C7079`（新） | `#FFFFFF` 输入区 | 4.96:1 | 通过 |
| `#6C7079`（新） | `#F5F5F7` 抽屉/侧栏（最差面） | **4.56:1** | 通过 |
| 深色 `#7F838C` | `#101012` | 5.00:1 | 通过（不动） |
| 浅色 `textSecondary` `#575A61` | `#FCFCFD` | 6.74:1 | 通过（不动） |

## 3. 原文（A 级，W3C）

来源：<https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html>（抓取 2026-11-25，HTTP 200）

> The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for the following: **Large Text** Large-scale text and images of large-scale text have a contrast ratio of at least 3:1; **Incidental** Text or images of text that are part of an inactive user interface component, that are pure decoration, that are not visible to anyone, or that are part of a picture that contains significant other visual content, have no contrast requirement.

> The 3:1 and 4.5:1 contrast ratios referenced in this success criterion are intended to be treated as threshold values. When comparing the computed contrast ratio to the Success Criterion ratio, the computed values should not be rounded (e.g., 4.499:1 would not meet the 4.5:1 threshold).

直译：正文文字与文字图像至少 4.5:1；「大字号」才允许 3:1；门槛不做四舍五入，4.499:1 不算通过。

我们的 `bodySmall` 是 12.5pt、提示文字 16.5pt，都远低于「大字号」（≥18pt 或 ≥14pt 加粗），所以适用 4.5:1。

## 4. 判断

- 时间分隔不是纯装饰：它回答「这段对话发生在哪天」，是内容的一部分，不能当作 incidental text 豁免。
- 输入框提示也不是装饰：它是用户第一次知道「这里可以长按说话」的唯一线索（见 0001 的同一条教训）。
- 但第三级色不能直接提到 `textSecondary`：`#575A61` 在深色主题对应 `#B9BCC3`，与正文对比过强，日期分隔会变得像标签一样抢注意力。Quiet Instrument 需要的是「安静但可读」，不是「安静到看不见」。

所以只在**浅色**调暗第三级，深色保持不动（深色已经 5.00:1）。选色顺序：从旧值向下找第一个在**所有浅色表面**（页面 `#FCFCFD`、输入区 `#FFFFFF`、抽屉 `#F5F5F7`）都 ≥4.5:1 的值，得到 `#6C7079`（4.84 / 4.96 / 4.56）。

## 5. 影响面

`textTertiary` 在 `apps/mobile_flutter/lib` 有 36 处引用：输入框提示、附件面板说明、设置页脚注、未选中图标、禁用态文字。全部受益，没有一处依赖「足够淡到看不见」。

改动只有一个 token：

```dart
// apps/mobile_flutter/lib/design/tokens.dart
static const Color lightTextTertiary = Color(0xFF6C7079);
```

同时更新 `docs/design/01-visual-language.md` 的颜色表。

## 6. 不做什么

- 不改品牌蓝 `#5686FE`：白色箭头在其上是 3.37:1，作为**图形**满足 1.4.11 的 3:1；改成更深的蓝会动品牌识别，不在这一条里决定。
- 不给第三级单独再造一个「divider 专用色」：已有的三级语义足够，多一级会让后来的人不知道该用哪个。
- 不改深色：深色 5.00:1 已过线，改了反而会削弱暗色主题的安静感。

## 7. 验收

- [x] 浅色页面/输入区/抽屉三个表面，第三级文字对比度 ≥4.5:1（4.84 / 4.96 / 4.56）。
- [x] 深色不变（5.00:1）。
- [x] 截图复核：`design-lab/shots/chat-light-2026-11-25.jpg`，「昨天/今天」与输入提示可读。
- [x] `flutter analyze` 无新增问题；`flutter test` 全绿（104 passed）。

## 8. 失效条件

- 如果将来引入更低对比的浅色表面（例如 `#F0F0F0` 以下的卡片底），需要重新计算，`#6C7079` 在最差面上只有 4.56:1 的余量。
- 如果设计系统决定把日期分隔改成「非文字线」，这条约束自动失效，改按 1.4.11 的非文字 3:1 检查。
