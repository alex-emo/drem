# 05 · 滚动物理与交互细节研究

- 状态：v0.1（2026-11-25）
- 触发：用户反馈「设计太普通，没有顺手的交互；滑动后停止的阻尼、上滑到顶的回弹」
- 方法：先查权威文档与量化参考，再决定实现；不凭手感拍参数
- 结论先行：**阻尼是惯性摩擦，回弹是越界弹簧，二者不是同一条动画曲线；Flutter 3.50 已内置 iOS 同款实现，优先用框架，不自己写 Simulation。**

---

## 1. 原文摘录

> 以下只摘录实际抓取到的页面原文；中文为我的译文，英文保留原文。抓取日期 2026-11-25。

### 1.1 Apple Human Interface Guidelines — Motion

来源：https://developer.apple.com/design/human-interface-guidelines/motion

> "Beautiful, fluid motions bring the interface to life, conveying status, providing feedback and instruction, and enriching the visual experience of your app or game."

> "Add motion purposefully, supporting the experience without overshadowing it. Don't add motion for the sake of adding motion. Gratuitous or excessive animation can distract people and may make them feel disconnected or physically uncomfortable."

> "Make motion optional. Not everyone can or wants to experience the motion in your app or game, so it's essential to avoid using it as the only way to communicate important information. To help everyone enjoy your app or game, supplement visual feedback by also using alternatives like haptics and audio to communicate."

> "Strive for realistic feedback motion that follows people's gestures and expectations. In nongame apps, accurate, realistic motion can help people understand how something works, but feedback motion that doesn't make sense can make people feel disoriented."

> "Aim for brevity and precision in feedback animations. When animated feedback is brief and precise, it tends to feel lightweight and unobtrusive."

> "In apps, generally avoid adding motion to UI interactions that occur frequently. The system already provides subtle animations for interactions with standard interface elements."

> "Let people cancel motion. As much as possible, don't make people wait for an animation to complete before they can do anything, especially if they have to experience the animation more than once."

我的译文要点：动效要有目的、可关闭、跟随手势、简短精确、别给高频操作加戏、别阻塞操作。

### 1.2 Flutter — BouncingScrollPhysics

来源：https://api.flutter.dev/flutter/widgets/BouncingScrollPhysics-class.html

> "Scroll physics for environments that allow the scroll offset to go beyond the bounds of the content, but then bounce the content back to the edge of those bounds."

> "This is the behavior typically seen on iOS."

> "BouncingScrollPhysics by itself will not create an overscroll effect if the contents of the scroll view do not extend beyond the size of the viewport. To create the overscroll and bounce effect regardless of the length of your scroll view, combine with AlwaysScrollableScrollPhysics."

构造参数原文：

> `BouncingScrollPhysics({ScrollDecelerationRate decelerationRate = ScrollDecelerationRate.normal, ScrollPhysics? parent})`

> `rubberBandSpring → SpringDescription` — "Spring used to animate overscroll bounce from a stationary release in iOS native style."

`ScrollDecelerationRate` 原文：

> `normal` — "Standard deceleration, aligned with mobile software expectations."

> `fast` — "Increased deceleration, aligned with desktop software expectations. Appropriate for use with input devices more precise than touch screens, such as trackpads or mouse wheels."

`frictionFactor` 原文：

> "The multiple applied to overscroll to make it appear that scrolling past the edge of the scrollable contents is harder than scrolling within bounds. This is done by reducing the ratio of the scroll effect output vs the scroll gesture input."

### 1.3 Flutter — ScrollPhysics 组合原则

来源：https://api.flutter.dev/flutter/widgets/ScrollPhysics-class.html

> "Instead of creating your own subclasses, parent can be used to combine ScrollPhysics objects of different types to get the desired scroll physics. For example: `const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics())`"

> "When implementing a subclass, you must override applyTo so that it returns an appropriate instance of your subclass. Otherwise, classes like Scrollable that inform a ScrollPosition will combine them with the default ScrollPhysics object instead of your custom subclass."

### 1.4 oh-my-design-cli — omd:feel 量化参考

来源：https://app.unpkg.com/oh-my-design-cli@2.0.0/files/skills/omd-feel/reference.md

> "The cross-system convergent band for routine UI is ~150-300ms (default ~200ms), with hovers ≤150ms and full-screen/overlay 300-500ms; exits run ~0.8× their enter. Functional UI motion stays under ~300ms; >400ms reads as sluggish."

> "Make exit/dismiss/collapse animations shorter than their enter — roughly 0.8× (75-85%)."

> "On Apple platforms, default UI motion to a spring (response 0.55, dampingFraction 0.825, blendDuration 0); think response+damping, not fixed duration."

> "Default spring bounce to 0 (smooth); use up to ~0.15 for liveliness, ~0.3 for noticeable bounce, but stay under ~0.4 for functional UI."

> "Reserve overshoot 'back' easings ... for playful emphasis only; never on dense/productive UI."

> "Use Apple-talk practitioner spring tuning by interaction context: light tap ~damping 0.4/response 0.2, momentum drawers ~0.8/0.3, draggable PiP ~1.0/0.4."

> "Animate only transform and opacity (composite-only, GPU); never use `transition: all`."

> "M3 standard easing cubic-bezier(0.2,0,0,1) for on-screen moves; standard-decelerate (0,0,0,1) for enters, standard-accelerate (0.3,0,1,1) for exits."

### 1.5 其他已读来源

- Apple WWDC18《Designing Fluid Interfaces》：手势连续性、可中断性、弹簧而非固定时长（转述，非逐字）。
- Material 3《Easing and duration》：duration token 以 50ms 为步长，entrance decelerate / exit accelerate（页面正文为 JS 渲染，未取到可引用段落，仅作背景）。
- Linear《Why is quality so rare?》：质量来自大量微小、可感知但不聒噪的细节（转述）。

---

## 2. 我的思考

### 2.1 为什么之前的“设计感”显得廉价

- 渐变、发光、模糊阴影、每帧重排：这些是**装饰**，和手势没有因果关系。用户的动作与画面变化对不上，就会读成“假科技感”。
- 真正的“高级感”来自**因果、连续、可预期**：手指拖多少，内容跟多少；松手后按物理继续走；越过边界有阻力；停下来的位置可预测。
- 所以先删装饰，再补物理。顺序反了，就会在廉价底子上叠更多特效。

### 2.2 “阻尼”和“回弹”是两套机制

- **滑动后停止的阻尼**：松手后的惯性衰减，属于 friction simulation（速度随时间的衰减），不是 `Curve`。iOS `UIScrollView.DecelerationRate.normal = 0.998/ms`；Flutter 3.50 用 `ScrollDecelerationRate.normal` 表达。
- **上滑到顶的回弹**：越界后的 spring（弹簧），由 `BouncingScrollPhysics.rubberBandSpring` 驱动；越界拖动时还有 `frictionFactor` 做“越拉越费力”的阻力。
- 用一条 300ms 的 `easeOut` 同时假装这两件事，必然不对：阻尼要按速度衰减，回弹要按弹簧收敛。

### 2.3 为什么最终删掉自写 Simulation

我先写了 `DreamScrollPhysics extends BouncingScrollPhysics`，自己用 `FrictionSimulation(0.135)` + 自调弹簧。查文档后删掉，原因：

1. Flutter 3.50 的 `BouncingScrollPhysics` 已经内置 iOS 同款惯性（`decelerationRate: normal`）与 `rubberBandSpring`，参数比手调更接近原生。
2. 自写 `createBallisticSimulation` 会绕过 `frictionFactor`、`carriedMomentum`、边界组合、`toleranceFor` 等既有行为，容易“手感对了、边界错了”。
3. `ScrollPhysics` 文档明确建议用 `parent` 组合，而不是继承重写。
4. 结论：`BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics(), decelerationRate: normal)` 就是当前最优解；`AlwaysScrollable` 保证内容不足一屏也能拉动回弹。

### 2.4 “举一反三”的检查维度

任何一个交互面，都按这 10 条过一遍：

1. **因果**：动作和反馈是否同一方向、同一比例？
2. **连续**：手势中途能否反向、能否接管？
3. **阈值**：多少距离/时间算“开始”，多少算“取消”？
4. **惯性**：松手后是否按速度继续，而不是立即停？
5. **边界**：越界是硬停、发光，还是带阻力回弹？
6. **落点**：动画结束是否可预测，是否会被新输入打断？
7. **触觉**：是否在关键确认点给一次，而不是每帧给？
8. **频率**：这个操作一天做多少次？高频操作不该有表演性动画。
9. **降级**：减少动效、低端机、键盘弹出时是否仍可用？
10. **延迟**：首帧/首字是否被动画阻塞？

### 2.5 已落地的取舍

- 全局滚动：`BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics(), decelerationRate: normal)`；移动端不画滚动条；触摸/触控笔/鼠标/触控板都可拖。
- 页面转场：进入 280ms、退出 220ms（约 0.8×），淡入 + 12px 上滑；减少动效时 0ms。
- 按压：90ms 进入、180ms 恢复，缩放 0.97，`selectionClick` 触感；比原来 120ms 对称更“跟手”。
- 输入框：单击输入，长按 420ms 说话，上滑 56pt 进入取消态；松手取消不发请求。
- 会话列表：左缘 44pt 滑动打开 Drawer，不再要求点右上角图标；列表内左滑删除 + 确认。
- 深度思考/联网：输入区上方小胶囊，点击切换并给 selection 触感；不再每条消息硬编码 `thinking: true`。

### 2.6 还没做（下一批）

- 消息列表自动跟随：距底部 <80px 时跟随流式；否则显示「回到底部」，点击 320ms 弹回。
- 顶部越界触觉：一次手势只给一次轻触，不按帧触发。
- 长按消息菜单、删除确认的触觉分级（medium / heavy）。
- 抽屉、弹层的弹簧落点与可中断性复核。
- `keyboardDismissBehavior: onDrag`，拖动列表时收键盘。
- 低端机 release 下的帧率复测（`dumpsys gfxinfo`）。

---

## 3. 参数决策表

| 维度 | 采用值 | 依据 |
|---|---|---|
| 滚动惯性 | `ScrollDecelerationRate.normal` | Flutter 3.50 iOS 对齐；UIScrollView normal |
| 越界回弹 | 框架 `rubberBandSpring`，不手调 | Flutter 内置 iOS 原生风格 |
| 短内容回弹 | `AlwaysScrollableScrollPhysics` | Flutter 文档明确要求 |
| 滚动条 | 移动端隐藏 | 触摸界面无鼠标悬停语义 |
| 页面进入 | 280ms，standard `cubic-bezier(0.2,0,0,1)` | M3 + 150–300ms 区间 |
| 页面退出 | 220ms（0.79×） | 退出约 0.8× 进入 |
| 按压进入/恢复 | 90ms / 180ms | 进入快、恢复柔，避免“黏” |
| 按压缩放 | 0.97 | 轻微、不位移布局 |
| 长按语音阈值 | 420ms | 高于系统长按 500ms？实测取 420ms，避免误触且不拖沓 |
| 语音取消阈值 | 上滑 56pt | 约一个指腹高度，防误取消 |
| 抽屉边缘 | 44pt | 大于最小触控目标，手感宽容 |
| 骨架屏 | 1200ms 循环 | 与 02 文档一致 |
| 减少动效 | 全部 0ms / 无位移 | Apple HIG + 无障碍要求 |

---

## 4. 组件映射

| 交互面 | 当前实现 | 文件 |
|---|---|---|
| 全局滚动 | `DreamScrollBehavior` + `dreamScrollPhysics` | `lib/design/dream_scroll_physics.dart` |
| 应用装配 | 三处 `MaterialApp` 均设 `scrollBehavior` | `lib/app/app.dart` |
| 页面转场 | `CustomTransitionPage` 淡入 + 上滑 | `lib/app/router.dart` |
| 按压 | `PressableScale`（90/180ms） | `lib/shared/widgets/pressable_scale.dart` |
| 输入/语音 | 长按 420ms、上滑 56pt 取消 | `lib/features/chat/widgets/composer.dart` |
| 会话抽屉 | `drawer` + `drawerEdgeDragWidth: 44` | `lib/features/chat/presentation/chat_screen.dart` |
| 消息列表 | 待补自动跟随/回到底部/触觉 | `lib/features/chat/widgets/message_list.dart` |

---

## 5. 来源

- Apple HIG Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- Flutter BouncingScrollPhysics: https://api.flutter.dev/flutter/widgets/BouncingScrollPhysics-class.html
- Flutter ScrollPhysics: https://api.flutter.dev/flutter/widgets/ScrollPhysics-class.html
- Flutter ScrollDecelerationRate: https://api.flutter.dev/flutter/widgets/ScrollDecelerationRate.html
- omd:feel quantified reference: https://app.unpkg.com/oh-my-design-cli@2.0.0/files/skills/omd-feel/reference.md
- Apple WWDC18 Designing Fluid Interfaces: https://developer.apple.com/videos/play/wwdc2018/803/
- Material 3 Easing and duration: https://m3.material.io/styles/motion/easing-and-duration
- Linear, Why is quality so rare?: https://linear.app/now/why-is-quality-so-rare
