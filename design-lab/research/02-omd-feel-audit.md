# 02 · omd:feel 审计（2026-11-25）

- 对象：`apps/mobile_flutter`（Flutter 3.50 / 分支 `feat/flutter-mobile-rewrite`）
- 语料：`design-lab/reference/omd-*.md`（C 级二次合成，抓取见 `reference/README.md`）
- 方法：用 113 条规则当检查表扫代码 → 只保留命中项 → 回到 A/B 级原文确认 → 分 BLOCK / WARN / FYI
- 结论口径：本审计**不产生新规范**。判定为 BLOCK 的已修；WARN 的写清为什么暂缓；FYI 只记录。

## 1. 命中项

### 1.1 命中区（SPEC：44pt / 48dp / 24px 下限）

规则原文要点（`omd-reference.md:146`）：「Give every interactive control a hit area ≥44×44pt (Apple/WCAG AAA), ≥48×48dp (Material/Android ≈9mm)…」

| 位置 | 改前 | 判定 | 处理 |
|---|---|---|---|
| `lib/features/chat/presentation/chat_screen.dart:599` `_ModeChip` | InkWell 包药丸，实测 78×**27** | BLOCK（<44，且间距仅 8） | 已修为 **78×44**（`ConstrainedBox(minHeight:44)`），视觉药丸不变；探针实测 `CHIP ink=Size(78.0, 44.0)` |
| `lib/features/chat/widgets/message_bubble.dart:376` 错误横幅「重试」 | `minimumSize: Size(44, 36)` | BLOCK（高 36） | 已改为 `Size(44, 44)` |
| `lib/features/chat/widgets/composer.dart` 麦克风 / 发送 | 44×44 | WARN（Android 48dp 未达） | 0006 一并改为 **48×48**，与 C 研究建议一致 |
| `lib/features/chat/widgets/chat_header.dart:97` 顶栏两个 44×44 | 44×44 | WARN（同上，44 达 AAA/Apple） | 暂留 44：顶栏固定 56pt，48 会挤压品牌与边距；记为已知偏差 |
| `composer.dart` 取消 / 停止 | 44×44 | WARN（同上） | 0006 改为 48×48 |

### 1.2 无障碍动作（SPEC：WCAG 4.1.2 / 2.1.1）

`lib/shared/widgets/pressable_scale.dart` 原来只有 `Semantics(button:, enabled:)`，没有 `onTap`。`GestureDetector` 不产生无障碍动作，读屏会念出「按钮」却无法激活。已补 `onTap: _enabled ? _handleTap : null`，并新增 `test/pressable_semantics_test.dart`（断言 `isButton + hasTapAction + isEnabled`）。5 处调用（空态建议、登录、动效页两处、聊天页）同时受益。

### 1.3 正文行高 4px 基线（SPEC）

规则原文（`omd-reference.md:64`）：「Round every line-height … to a multiple of 4px so baselines land on a 4px vertical grid.」

实测（`lib/design/dream_theme.dart:180-182`）：

| 样式 | 字号 × 行高 | 实际行高 | 4px 余数 |
|---|---|---|---|
| bodyLarge | 16 × 1.55 | 24.8 | 0.8 |
| bodyMedium | 14 × 1.5 | 21.0 | 1.0 |
| bodySmall | 12.5 × 1.45 | 18.125 | 2.125 |
| 气泡正文（CJK） | 16.5 × 1.62 | 26.73 | 2.73 |

判定 **WARN，暂缓**。原因不是「不做」，而是这四项一改会重排所有页面（消息气泡、空态、设置、抽屉），而且中文行高与 4px 网格不是天然对齐：16.5×1.62 是为中文密度选的，直接压到 24px 会明显变挤。正确处理是单独做一次排版决策：先定字号阶梯（16.5 本身不在 1.2–1.333 的模块比例上），再定行高网格，并用同一屏截图对比。建议编号 0007。

### 1.4 动效时长阶梯（SPEC for M3-aligned / DS）

规则原文要点：`omd-reference.md:31`「Quantize every duration to the M3 token scale (50ms steps 50–600…)」；`:39`「Make exit/dismiss animations shorter than their enter — roughly 0.8×」。

`lib/design/tokens.dart:28-40` 现状：

| token | 值 | 是否在 50ms 网格 |
|---|---|---|
| press | 120 | 否 |
| pressIn | 90 | 否 |
| pressOut | 180 | 否 |
| fast | 180 | 否 |
| page | 280 | 否 |
| pageOut | 220 | 否（280×0.79，比例本身合规） |
| bubble | 260 | 否 |
| staggerStep | 45 | 否（step，不是时长 token，可豁免） |
| errorIn | 220 | 否 |
| skeleton | 1200 | 否（循环，可豁免） |
| cursor | 600 | 否（循环，可豁免） |

判定 **WARN，暂缓**。理由：

1. Dream 不是 M3-aligned 设计系统；这条规则对「已承诺 M3 阶梯」的系统是 SPEC，对我们是 **CONV 级建议**。
2. 改法不是简单取整：`pressIn 90 → 100`、`pressOut 180 → 200` 会让「松开」比「按下」慢，现有手感是按下快、回弹稍慢，这属于按压反馈而不是 enter/exit 对，`0.8×` 规则不直接适用。
3. 真正需要成对的是 `page/pageOut`（280/220，比例 0.79 已合规）。若取整为 300/250，比例 0.83，仍合规，但 `page` 会从 280 变 300，路由返回也要同步。

建议在 0007 或 0008 里一次性做：定阶梯 `{100,150,200,250,300}` + 循环 token 单独命名，然后跑 `motion_lab` 与真机录屏确认。**在动效页逐个目测之前不改。**

### 1.5 其余抽检

| 规则 | 结果 |
|---|---|
| 8px 间距网格（CONV） | 通过：`DreamSpacing` 为 4/8/12/16/24/32/48；`pageMargin=20` 在 4px 网格上、不在 8px 上（记录，不改） |
| 正文 measure 45–75 字符（CONV/OP） | 通过：气泡最大宽 78% 屏宽，中文约 34 字/行 |
| 遮罩 30–60%（DS） | 通过：`Drawer` 用 Material 默认 `black54`（54%） |
| 按压反馈 scale 0.95–0.97（CONV） | 通过：`PressableScale` 0.97；但时长 90/180ms 低于建议的 ~150ms（FYI） |
| 减少动效（SPEC 精神） | 通过：`PressableScale`、空态、动效页、设置页均有 `MediaQuery.disableAnimationsOf` 分支；`DreamMotion` 的页面转场未逐一核（FYI） |
| 文本对比 4.5:1（SPEC） | 通过：`textTertiary` 已于 0003 修为 `#6C7079`（4.84/4.96/4.56）；`textSecondary` 6.74 |
| 键盘焦点可见（SPEC） | **未审计**：产品是触摸优先，无硬件键盘路径；若未来上 Web/桌面需补 |
| RTL / 图片 / 暗色 elevation / hover | 未审计（本轮范围外） |

## 2. 做了什么（代码）

1. `_ModeChip` 命中区 27→44（`chat_screen.dart`）。
2. 错误横幅「重试」36→44（`message_bubble.dart`）。
3. 麦克风/发送/取消/停止 44→48，麦克风固定槽位（0006，`composer.dart`）。
4. `PressableScale` 补 `onTap` 语义 + 回归测试。

## 3. 没做什么（明确）

- 未改行高、字号、动效 token：需要单独的排版/动效决策与视觉对比，不能混在审计里「顺手」改。
- 未把顶栏 44 改成 48：56pt 顶栏下 48 会让品牌与图标贴边，收益低于代价；记录为已知偏差。
- 未逐条跑 113 条规则，也未给项目打「设计分」：清单是提问工具，不是评分表。

## 4. 失效条件

- 若产品决定全面对齐 Material 3（含组件、状态层、动态色），1.1 的 44 偏差与 1.4 的时长阶梯都要重开。
- 若上线 Web/桌面端，键盘焦点与 hover 两条必须补审计。
- 若中文行高改由字体 metrics 自动决定（如 `TextHeightBehavior` + 字体基线），1.3 的 4px 手工网格需要重新评估。
