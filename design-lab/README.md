# Design Lab · UI / 交互设计老师的工作台

> 位置：仓库根目录 `design-lab/`
> 范围：`apps/mobile_flutter/`（Dream Flutter 客户端）的表现层
> 当前分支：`feat/flutter-mobile-rewrite`
> 建立：2026-11-25

## 我是谁

我是这个项目的 UI 设计与交互设计老师。我不接“把按钮换个颜色”的活，也不替产品做业务决定。我做的事是：

1. 找到这件事上做得最好的案例和它背后的哲学；
2. 想清楚它为什么有效、在 Dream 的语境里意味着什么；
3. 把原文和思考写进这个文件夹；
4. 再改代码，并用测试和截图证明改动成立。

第一条约束的原文见 [constraints.md](constraints.md)。

## 文件夹怎么用

```text
design-lab/
  README.md            你在这里：角色、流程、索引
  constraints.md       八条约束；第一条是用户原话
  research/            案例与哲学摘录（原文 + 翻译 + 我的解读）+ 审计
    README.md          摘录格式与可信度规则
  reference/           外部整包语料（C 级二次合成，只用来提问）
    README.md          来源、分级、使用/禁用规则
  decisions/           设计决策记录（问题 → 方案 → 取舍 → 验收）
  journal/             每次工作的时间线：查了什么、改了什么、验证了什么
  shots/               真实渲染截图（1x，430×932），按日期归档
  tools/               截图与字体工具（不进测试套件）
```

## 决策程序（不可跳步）

```text
观察（截图 / 代码 / 用户路径）
  → 提问（用户此刻需要知道什么？）
  → 研究（找 2–4 个高质量来源，抄原文）
  → 思考（它解决的是哪个心理/感知问题？在 Dream 成立吗？）
  → 落盘（research 摘录 + decisions 决策）
  → 改代码（最小、可回滚）
  → 验证（analyze / test / 截图）
```

## 与 `docs/design/` 的关系

`docs/design/` 是上一轮团队留下的设计系统与规范（Quiet Instrument、tokens、动效参数），仍然有效，是我工作的**输入**。`design-lab/` 是我这一轮的工作台：新的研究、新的决策、新的实验都先在这里落盘；成熟后再回写 `docs/design/`，避免两套规范各说各话。

## 当前进度

| 日期 | 研究 | 决策 | 代码 | 状态 |
|---|---|---|---|---|
| 2026-11-25 | 可发现性（NN/g、Calm Technology、HCI.TOP）· 手势学习（Apple HIG 等） | `0001` 给会话一个可见把手，手势降级为加速器 | `ChatHeader` + 删除首屏手势横幅 | 已完成，待真机观察 |
| 2026-11-25 | 聊天产品手势与时间锚点（MUI X Chat、Slack、iMessage、腾讯云 IM） | `0002` 时间锚点只按天切，精确时间不新增手势 | `DayDivider` + `dayAnchorLabel` | 已完成 |
| 2026-11-25 | WCAG 2.1 SC 1.4.3 对比度门槛 | `0003` 浅色第三级文字 `#858992`→`#6C7079`（3.42:1→4.84:1） | `tokens.dart` 一个 token | 已完成 |
| 2026-11-25 | 手势竞技场与组合手势（自查探针） | `0004` 长按只看输入框、且只在未聚焦时录音 | `composer.dart` 手势作用域 + 2 条回归测试 | 已完成 |
| 2026-11-25 | 语音没有可见入口（iOS 听写/微信官方） | `0005` 输入为空时右侧麦克风，轻点聆听、停止/取消，长按输入行保留为加速器 | `composer.dart` 麦克风与聆听态 + 6 条测试 + 三张截图 | 已被 0006 修订布局 |
| 2026-11-25 | C 研究返回（Telegram/Signal/iMessage、48dp、WCAG 2.5.1） | `0006` 麦克风固定槽位 48dp + 双态可见取消/停止 + 60 秒上限 + 转写撤销/重试 | `composer.dart` 布局与计时、`chat_screen.dart` 撤销/重试、7 条测试 + 四张截图 | 已完成，114 passed |
| 2026-11-25 | omd:feel 语料（C 级）+ WCAG/M3 原文复核 | 审计：命中区 27→44、重试 36→44、PressableScale 补 onTap；排版/动效暂缓 | `_ModeChip`、错误横幅、`pressable_scale.dart` | 已完成，见 research/02 |

## 索引

**研究**
- [research/01-navigation-discoverability.md](research/01-navigation-discoverability.md)：为什么「加一条提示」修不好「会话没有入口」；NN/g 加速器/隐藏导航/识别回忆、Calm Technology、HCI.TOP 零像素控件。
- [research/A-gesture-learnability.md](research/A-gesture-learnability.md)：隐藏手势何时教、在哪教、何时消失；NN/g 教练层与教程数据、Apple HIG Onboarding。
- [research/B-chat-patterns.md](research/B-chat-patterns.md)：聊天产品的手势合规性、系统返回冲突、时间锚点阈值与文案；MUI X Chat、Slack、iMessage、腾讯云 IM。
- [research/C-voice-entry.md](research/C-voice-entry.md)：语音入口形态（互换 vs 常驻）、按住 vs 点按、取消与上限、转写确认；21 个来源。
- [research/02-omd-feel-audit.md](research/02-omd-feel-audit.md)：拿 omd:feel 113 条当检查表扫 Dream，BLOCK/WARN/FYI 与「暂缓」理由。

**决策**
- [decisions/0001-session-drawer-affordance.md](decisions/0001-session-drawer-affordance.md)：顶栏左菜单 + 右新对话，删除首屏横幅；备选方案与失效条件。
- [decisions/0002-day-anchors.md](decisions/0002-day-anchors.md)：只在本地日界插日期分隔；拒绝 5 分钟阈值，精确时间留给长按动作条。

- [decisions/0003-readable-tertiary.md](decisions/0003-readable-tertiary.md)：「昨天」「轻点输入」这类第三级文字在浅色下只有 3.42:1，调到 4.84:1；为什么只动浅色、为什么不动品牌蓝。
- [decisions/0004-composer-gesture-conflicts.md](decisions/0004-composer-gesture-conflicts.md)：聚焦选字与长按说话抢同一块玻璃、按住发送键误入录音；手势收窄到输入框 + 聚焦守卫。

- [decisions/0005-voice-entry.md](decisions/0005-voice-entry.md)：语音为什么必须有可见入口；iOS 听写（点按切换）与微信（先切模式再按住）两套 A 级证据；点按/按住/两步三种模型的取舍与实现记录。
- [decisions/0006-voice-entry-v2.md](decisions/0006-voice-entry-v2.md)：C 研究推翻「互换槽位」；麦克风固定 48dp、发送键占位、双态取消/停止、60 秒上限、转写撤销/重试。

**截图**
- [shots/chat-dark-2026-11-25.jpg](shots/chat-dark-2026-11-25.jpg)：深色，430×932，真实组件 + 假数据。
- [shots/chat-light-2026-11-25.jpg](shots/chat-light-2026-11-25.jpg)：浅色当前版本（0003 之后）。
- composer-voice-idle / typing / typing-light / listening-dark / listening-light（2026-11-25）：输入区五张组件截图（0006 之后）。

**时间线**
- [journal/2026-11-25.md](journal/2026-11-25.md)

**参考语料**
- [reference/README.md](reference/README.md)：omd:feel 的来源、分级与使用规则——它不是本项目的 A/B 证据。

**抓取台账**
- [ledger.md](ledger.md)：每个来源的 URL、抓取日期、HTTP 状态与可信度。

## 验证

### 静态与单测

```bash
cd apps/mobile_flutter
../../.flutter/bin/flutter analyze
../../.flutter/bin/flutter test
```

### 真实渲染

不依赖登录和后端，用 `lib/dev/design_preview.dart` 的假数据在 Linux 桌面上跑真实组件：

```bash
cd apps/mobile_flutter
../../.flutter/bin/flutter run -d linux -t lib/dev/design_preview.dart
```

（`linux/` 桌面脚手架由 `flutter create --platforms=linux .` 生成，窗口默认 430×900，模拟手机宽度。）

### 截图归档

截图走 widget test 的软件渲染，避免受合成器/窗口遮挡影响：

```bash
# 1. FontLoader 读不了 .ttc，先把 SC 那一面拆成 ttf
python3 design-lab/tools/ttc2ttf.py \
  /usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc /tmp/noto-cjk
# 2. 临时拷进 test/ 跑一次
cp design-lab/tools/screenshot_test.dart apps/mobile_flutter/test/_shot_test.dart
# 输入区四态：cp design-lab/tools/composer_screenshot_test.dart apps/mobile_flutter/test/_shot_voice_test.dart
cd apps/mobile_flutter && ../../.flutter/bin/flutter test test/_shot_test.dart
# 3. 产出在 /tmp/dream-shot-dark.png、/tmp/dream-shot-light.png
#    （Icon 字体与 CJK 字体由 harness 自行加载）
```

跑完删掉 `test/_shot_test.dart`，只把图片归到 `design-lab/shots/`。

## 工作纪律

- 一次只解决一个用户可感知的问题；不顺手重构。
- 每个决策至少一条可自动验证的测试，或一条可复现的手工验收步骤。
- 研究没读透就不写结论；写不出“这意味着什么”就不改代码。
