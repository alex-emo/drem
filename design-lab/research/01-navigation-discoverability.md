# 01 · 会话入口的可发现性

> 抓取日期：2026-11-25 · 可信度：A（NN/g 原文）+ B（HCI.TOP 知识卡，二手汇编）
> 对应决策：[decisions/0001-session-drawer-affordance.md](../decisions/0001-session-drawer-affordance.md)

## 0. 要回答的问题

Dream 聊天页的会话抽屉，**只能**从屏幕左缘右滑打开：顶栏没有按钮，只有一行不可点的灰字「左滑会话」。首次进入时还会出现一条 4 秒的横幅「左滑看会话 · 长按说话」。

要判断的是：这条横幅够不够？如果不够，缺的到底是什么？

---

## 1. 手势是加速器，不是主路径

**Accelerators Maximize Efficiency in User Interfaces** · Rachel Krause & Aurora Harley · 2024-10-18
<https://www.nngroup.com/articles/ui-accelerators/>

章节：What Are Accelerators? / Discoverability of Accelerators

> “An **accelerator** is a UI feature that speeds up an interaction or process.”

> “Accelerators should be **additional, alternate ways to accomplish a task** — something that expert users can take advantage of, but that others can ignore completely.”

> “Because accelerators are enhancements to the interface, **discovering them should not be critical** **to learning and using the interface**.”

> “For that reason, accelerators should be readily **available, yet easy to ignore**.”

> “For less-obvious shortcuts, it's best to **introduce accelerators after a user performs the action in the standard way**. Just-in-time help ... makes it more likely that users will attend to the tip since it relates to their current task.”

直译：加速器是一种加快交互或流程的界面特性。它应当是完成同一任务的**额外、替代**方式——熟练用户可以用，其他人可以完全忽略。正因为它是增强项，**发现它不应成为学会和使用这个界面的关键**。所以加速器应当随时可用，又容易被忽略。对不明显的快捷方式，最好在用户**先用标准方式完成动作之后**再介绍。

我的解读：这段话把「手势」放回了它该在的位置——手势是第二条路。判断标准不是「用户知不知道能滑」，而是「不知道能滑的人，还能不能完成任务」。Dream 现在的答案是「不能」：不滑就永远进不了会话列表，也就进不了设置。横幅是在教第二条路，却让第一条路根本不存在。

对 Dream 的可用点：会话抽屉必须先有一个可点、可见的入口（顶栏按钮）；左缘滑动保留，作为同一动作的加速器。教学文案的时机也应后置，而不是开屏就讲。

不适用点：如果某个手势已经是系统级约定（如 iOS 左缘返回），系统本身提供了可见替代（返回箭头），应用无需重复画一遍。会话抽屉是 Dream 私有命令，不在豁免范围。

---

## 2. 藏起来的导航，发现率接近减半

**Hamburger Menus and Hidden Navigation Hurt UX Metrics** · Kara Pernice & Raluca Budiu · 2016-06-26
<https://www.nngroup.com/articles/hamburger-menus/>

章节：Summary / 开篇结论

> “**Discoverability is cut almost in half by hiding a website's main navigation.** Also, task time is longer and perceived task difficulty increases.”

> “**Hidden navigation is less discoverable** than visible or partially visible navigation. When navigation is hidden, users are less likely to use navigation. If people use hidden navigation, they do so later in the task than if it were visible.”

直译：把网站主导航藏起来，可发现性几乎减半；任务时间更长，主观难度更高。隐藏导航比可见或部分可见导航更难被发现；导航被隐藏时，用户更少使用导航；即使使用，也比可见时更晚才用。

我的解读：这条研究针对的是「汉堡菜单 vs 顶部可见链接」，结论方向是**能看见的入口优于藏起来的入口**。Dream 比汉堡菜单更极端：连汉堡图标都没有，只剩一条屏幕边缘。因此此处不是「要不要用汉堡菜单」的争论，而是「从零个可见入口补到一个」的止损。

对 Dream 的可用点：顶栏菜单按钮把入口从「零像素」提升到「44×44 可见控件」；这是本决策的主要收益，不能用「抽屉本身仍是隐藏导航」来否定它。

不适用点：研究测的是网站主导航与内容发现，不是聊天产品的会话切换频率；不能据此推断「必须改成常驻列表」。常驻列表是结构级选择，需要单独论证。

---

## 3. 识别优于回忆

**Memory Recognition and Recall in User Interfaces** · Raluca Budiu · 2024-01-15
<https://www.nngroup.com/articles/recognition-and-recall/>

章节：Summary / Recognition vs. Recall

> “Recalling items from scratch is harder than recognizing the correct option in a list of choices because the extra context helps users retrieve information from memory.”

> “The **difference between recognition and recall is the number of cues** that help memory retrieval; recall involves fewer cues than recognition.”

直译：从零回忆比在一列选项里认出正确答案更难，因为额外上下文帮助用户从记忆中提取信息。识别与回忆的差别在于**帮助记忆提取的线索数量**；回忆的线索更少。

我的解读：边缘手势要求用户先在脑中生成「这里也许能滑」这个假设——这是纯粹的回忆，界面上没有任何线索。一个可见的菜单图标把同一件事变成识别：看见，点，完成。提示横幅只是把线索临时借给用户 4 秒，之后又收回去。

对 Dream 的可用点：可发现性应当由**常驻的视觉线索**承担，而不是一次性的文字提示。菜单按钮是常驻线索；横幅不是。

不适用点：线索过多会稀释注意力（见第 5 节），所以只补一个入口，不补一排入口。

---

## 4. 二手汇编：零像素控件与首次引导（B 级）

以下三张卡片来自 HCI.TOP 知识卡库，是中文二手汇编，未逐条标注原始文献，**只用于说明机制，不作为结论的唯一依据**。

### 4.1 手势不占用屏幕面积，也因此不可见
<https://hci.top/zh/handbook/C3.20.1> · 抓取 2026-11-25

> “按钮至少占一块像素，手势**不占用屏幕面积**，执行前后界面可以完全不变。省下来的空间换来的是：用户在行动前看不到可做之事。”

> “可发现性差不是文案没写好，而是零像素控件没有可供识别的外形。”

> “需要保留手势时，至少留一个可被看见的残迹：露边、手柄、或可点的同等按钮。”

### 4.2 首次引导无法承担长期可发现性
<https://hci.top/zh/handbook/C3.20.2> · 抓取 2026-11-25

> “**首次引导不能承担长期可发现性**：看过不等于当时学会，学会也不等于几周后还能找回来。手势在界面上仍然没有外形，教程消失后，发现通道就一起消失。”

> “把可发现性外包给第一次打开，是把记忆问题误当成一次性通知问题。”

### 4.3 手势不能是功能的唯一入口
<https://hci.top/zh/handbook/C3.20.4> · 抓取 2026-11-25

> “即使某个手势被高频用户用得很顺，**它也不能做该功能的唯一入口**。必须还有可被看见、可被点中的路径：工具栏按钮、菜单项、上下文操作。”

> “从未想到轨迹的人，和做不出轨迹的人，失败看起来一样：功能等于不存在。”

我的解读：这三条恰好对应 Dream 现状的三层问题——控件零像素（4.1）、把可发现性押在一次性横幅上（4.2）、抽屉是唯一入口（4.3）。它们与第 1 节的 A 级材料互相印证，但即使删掉这一节，结论也不变。

不适用点：卡片没有给出量化数据，不能用来声称「提升百分之多少」。

---

## 5. 提示应该待在边缘

**Calm Technology** · Mark Weiser & John Seely Brown · 1996-10-05
<https://calmtech.com/papers/computer-for-21st-century.html>

（原文抓取与逐字摘录见 `ledger.md` 的 2026-11-25 条目。）

> “Calm technology engages both the center and the periphery of our attention, and in fact moves back and forth between the two.”

直译：平静的技术同时占据注意力的中心与边缘，并在两者之间来回移动。

我的解读：横幅把一条「可选知识」放进屏幕中心区域，而且是在用户还没有任何会话、最不需要切换会话的时刻。它既没有绑定任务，也没有留在边缘。真正平静的做法是：入口常驻在边缘（顶栏一个 20px 图标），需要时被看见，不需要时被忽略。

对 Dream 的可用点：删掉横幅，不删信息——信息由常驻按钮承载。若将来要教左缘滑动，应在用户**第一次从菜单打开抽屉之后**，在抽屉底部给一行 12px 的「下次可以从屏幕左缘右滑」，看完即消失，而不是开屏拦截。

不适用点：这是 1996 年的普适计算论文，不是移动端可用性实验；它给的是注意力分配的原则，不是像素参数。

---

## 6. 思考：为什么「加一条提示」是错的解法

1. **问题被描述错了。** 现状不是「用户不知道有手势」，而是「会话列表没有入口」。前者用文案修，后者必须用控件修。横幅修的是前者。
2. **横幅的时机与位置都在错误的半区。** 它在用户还没有会话时出现（无任务绑定），占据内容顶部（中心区），4 秒后永久消失（把记忆问题当通知问题）。三处都撞在第 1、4.2、5 节上。
3. **手势删不掉，但必须降级。** 左缘滑动符合平台习惯，熟练用户会形成肌肉记忆，删掉是倒退。正确做法是让它从「唯一入口」变成「第二条路」。
4. **补一个入口不是「把导航藏进汉堡」。** 现状已经是全隐藏；补图标是把可发现性从零拉回可见控件水平。NN/g 反对的是「把本来可见的导航藏起来」，不是「给已经藏起来的导航补一个把手」。
5. **顶栏仍然只做两件事。** 左：打开会话（导航）；右：新对话（动作）。设置留在抽屉底部，搜索留在抽屉（P0-4），深度/联网留在输入区上方的胶囊。品牌不再充当唯一内容。

## 7. 落到像素

| 位置 | 规格 | 理由 |
|---|---|---|
| 顶栏左 | 44×44 IconButton，`Icons.menu_rounded`，20px，`textSecondary`，tooltip「会话」 | 44pt 最小触控；图标在品牌左侧，符合 Material 顶栏「导航在前、标题在后」的阅读顺序 |
| 左簇间距 | 按钮 → 4px → DreamMark 22 → 8px → 「Dream」15/600 | 收紧品牌与按钮的距离，避免 44px 控件把品牌推得过远 |
| 顶栏右 | 44×44 IconButton，`Icons.add_comment_outlined`，20px，`textSecondary`，tooltip「新对话」 | 会话内最高频的「重新开始」动作；与抽屉里的「新对话」提交同一操作 |
| 顶栏高度 | 56pt，水平 20/28 | 沿用 `chat-shell.md` 契约；按钮自带 44pt 命中区，不需要额外加大 |
| 横幅 | 删除组件、状态、计时器与 `dream-gesture-hint-seen` 写入 | 见第 6 节；删除同时消除布局跳动 |
| 抽屉手势 | `drawerEdgeDragWidth: 44` 保留 | 加速器保留；平台惯例 |

## 8. 什么情况下这个决策会失效

- 平板/桌面宽度 ≥ 840 时若改为常驻会话侧栏，菜单按钮应隐藏——那时入口已经常驻，按钮是重复。
- 若产品决定把「会话列表」升级为独立页面（而非抽屉），本决策整体被取代，只保留「手势必须降级为加速器」这一条。
- 若顶栏右侧的「新对话」与输入区首焦点竞争注意力，应回退为只有菜单按钮；以真实使用数据为准。
