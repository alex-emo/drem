# B · 聊天产品的手势教学与时间锚点

> 研究问题：Dream 聊天页的两个隐藏手势（左缘右滑开抽屉、长按输入框进语音）在平台规范里被允许到什么程度、该配什么可见替代；长会话的日期/时间分隔按什么条件、什么文案出现。
> 以下结论尽量只从逐字原文推出；只有二手描述的地方已标注「B 级 / 未取得原文，仅转述」。没有看过 Dream 以外任何产品的截图或真机，全部依据页面文字。

## 一、手势

### 来源 1：Apple Human Interface Guidelines · Gestures
- URL：https://developer.apple.com/design/human-interface-guidelines/gestures
- 抓取日期：2026-11-25
- 章节：Gestures（含「Standard gestures」表与页尾 Change log，页面标注 October 28, 2026 更新）
- 原文（verbatim，1–3 句）：
  > Avoid using a familiar gesture like tap or swipe to perform an action that’s unique to your app; similarly, avoid creating a unique gesture to perform a standard action like activating a button or scrolling a long view.
  >
  > Add custom gestures only when necessary.
  >
  > Use shortcut gestures to supplement standard gestures, not replace them.
- 直译：不要用一个熟悉的手势（点按、滑动）去做只属于你这个 App 的动作；同样，也不要发明一个独特手势去做标准动作（激活按钮、滚动长视图）。／ 只在必要时添加自定义手势。／ 用快捷手势去补充标准手势，而不是替代它们。
- 具体做法（可核对）：该页把自定手势的成立条件列成四条——Discoverable（可发现）、Straightforward to perform（做起来直接）、Distinct from other gestures（与其他手势可区分）、Not the only way to perform an important action in your app or game（不能是重要动作的唯一途径）。同页还写 "Make custom gestures easy to learn. Offer moments in your app to help people quickly learn and perform custom gestures"，并要求 "Avoid conflicting with gestures that access system UI."。标准手势表里，Swipe 的定义是 "Reveal actions and controls; dismiss views; scroll."，Touch (or pinch) and hold 是 "Reveal additional controls or functionality."。
- 对 Dream 的可用点：左缘右滑属于「Swipe = reveal controls」，语义合规；但「打开会话列表」是重要动作，按第四条必须另有可见入口（左上角 44×44pt 的会话按钮）。长按输入框进语音属于「Touch and hold = reveal additional controls」，也合规，但同样不能是进语音的唯一方式（见综合判断第 2 条）。
- 不适用点：HIG 是 iOS 视角的，且默认系统级边缘手势（返回）已存在；Dream 的 Flutter 壳跨平台，Android 侧要按 Material 的预测式返回重新核算，不能直接照搬。

### 来源 2：Apple Human Interface Guidelines · Context Menus
- URL：https://developer.apple.com/design/human-interface-guidelines/context-menus
- 抓取日期：2026-11-25
- 章节：Context menus（Best practices 段）
- 原文（verbatim，1–3 句）：
  > Although a context menu provides convenient access to frequently used items, it’s hidden by default, so people might not know it’s there.
  >
  > Always make context menu items available in the main interface, too.
  >
  > Aim for a small number of menu items.
- 直译：上下文菜单虽然能方便地访问常用项，但它默认是隐藏的，所以人们可能不知道它在那里。／ 永远让上下文菜单里的项目在主界面里也能被找到。／ 菜单项数量要少。
- 具体做法（可核对）：该页用「隐藏的入口 → 必须在主界面有等价出口」作为硬约束；同页还要求 "Hide unavailable menu items, don’t dim them."，iOS 上破坏性操作放列表末尾并标红。这条与「隐藏手势」同构：隐藏本身不是问题，隐藏且没有别路才是问题。
- 对 Dream 的可用点：长按消息弹出的「复制 / 编辑 / 重新生成」若将来迁到别处，必须保留主界面等价入口；长按输入框进语音同理——语音入口要在输入框右侧常驻，长按只是加速器。抽屉里的会话操作（置顶、删除）不能只藏在长按菜单里。
- 不适用点：讲的是菜单而非手势；「主界面也要有」在聊天页会与「内容优先、少放按钮」的 Quiet Instrument 冲突，需要限制为每屏至多 1 个新增常驻按钮。

### 来源 3：Apple Human Interface Guidelines · Onboarding
- URL：https://developer.apple.com/design/human-interface-guidelines/onboarding
- 抓取日期：2026-11-25
- 章节：Onboarding（Best practices 段）
- 原文（verbatim，1–3 句）：
  > Ideally, people can understand your app or game simply by experiencing it, but if onboarding is necessary, design a flow that’s fast, fun, and optional.
  >
  > If you let people skip the tutorial when they first launch your app or game, don’t present it again on subsequent launches, but make sure it’s easy for people to find if they want to view it later.
- 直译：理想情况下，人们仅靠使用就能理解你的 App；如果确实需要引导，就把流程设计得快速、有趣、可跳过。／ 如果你允许用户在首次启动时跳过教程，那么后续启动就不要再弹出它，但要保证用户之后想看时容易找到。
- 具体做法（可核对）：补充同页的 "Consider providing a collection of context-specific tips instead of a single onboarding flow" 与 "display these instructions near that area"——Apple 的默认方案是「贴在对应区域附近的一组小提示」，不是全屏引导。跳过之后不再重复出现，但要留可回看的入口。
- 对 Dream 的可用点：Dream 现有 `_maybeShowGestureHint` 用 SharedPreferences key `'dream-gesture-hint-seen'` 只显示一次、`Timer(const Duration(seconds: 4))` 后隐藏——「只出现一次」符合本条；缺的是「之后想看时容易找到」，即设置页里应有一行「手势说明」（行高 ≥44pt）。
- 不适用点：HIG 假设用户能通过探索发现功能，而 Dream 的左缘抽屉在 iOS 上会被系统返回手势吃掉，探索路径本身不成立；提示地点也需要从「屏幕中部」改成「左缘 + 输入框上沿」。

### 来源 4：Material Design 3 · Gestures
- URL：https://m3.material.io/foundations/interaction/gestures
- 抓取日期：2026-11-25
- 章节：Foundations → Interaction → Gestures（含 Predictive back 段）
- 原文（verbatim，1–3 句）：
  > Gestures are all the ways people interact with UI elements using touch.
  >
  > On Android, a person can swipe left or right on certain components as a way to navigate to a previous destination. This gesture is called predictive back.
- 直译：手势是人们用触摸与 UI 元素交互的全部方式。／ 在 Android 上，人可以在某些组件上向左或向右滑动，作为返回上一个目的地的操作。这个手势叫预测式返回。
- 具体做法（可核对）：该页列出的预测式返回适用组件是 bottom sheet、navigation bar、navigation rail、search bar、side sheet；也就是说「从边缘向内滑」在 Android 上已经被系统征用为返回，第三方 App 的侧滑抽屉必须与它共存或让路。
- 对 Dream 的可用点：抽屉只能在「非边缘区域」或「明确无返回意图」的页面启用边缘拖拽；Dream 现在 `drawerEdgeDragWidth: 44` 的 44dp 热区会与 Android 系统返回热区重叠，需要在 Android 上收窄或改用「从内容区任意位置向右拖」。
- 不适用点：该页只给组件兼容清单，没有给热区像素与冲突优先级；44dp 这个数字来自 Dream 自己的实现，不是 Material 的规范值。

### 来源 5：Material Design 3 · State layers
- URL：https://m3.material.io/foundations/interaction/states/state-layers
- 抓取日期：2026-11-25
- 章节：Foundations → Interaction → States → State layers
- 原文（verbatim，1–3 句）：
  > The size of state layers is 40dp while the interactive target size is 48dp.
  >
  > Hover +8% opacity, Focus +10% opacity, Press +10% opacity, Drag +16% opacity.
- 直译：状态层的尺寸是 40dp，而可交互目标的尺寸是 48dp。／ 悬停 +8% 不透明度，聚焦 +10%，按压 +10%，拖拽 +16%。
- 具体做法（可核对）：Material 用「状态层比点击目标小一圈」来同时满足「按下有反馈」与「48dp 可点」；拖拽态的不透明度最高（16%），因为拖拽是持续动作、需要更强的「抓住了」的信号。（注：该页正文由 JS 渲染，2026-11-25 复查时只返回标题；上面 40dp 与四个百分比取自当天首次抓取到的正文，未能二次逐字复核，按 B 级使用。）
- 对 Dream 的可用点：左缘抽屉拖拽过程中给 16% 的状态层（或等效的 Drawer 遮罩渐入），比现在的「无反馈直到抽屉出现」更符合 Material；输入框长按进语音时给 10% 按压态 + 120ms（Dream 现有按压时长）反馈。
- 不适用点：48dp 是 Android 的触摸目标下限；Dream 的 44pt 来自 iOS/自家 constraints，两者不要混用；状态层数值是「叠加在表面色上的百分比」，深色主题下 16% 会明显偏亮，需要重算。

### 来源 6：Things 3 · Using Gestures（官方支持页）
- URL：https://culturedcode.com/things/support/articles/2803582/
- 抓取日期：2026-11-25
- 章节：Using Gestures（全文）
- 原文（verbatim，1–3 句）：
  > Drag the Magic Plus Button anywhere you'd like in a list, and your new to-do will be inserted where you drop it.
  >
  > To select a to-do, swipe it to the left.
  >
  > Pull down in any list to start a Search.
- 直译：把「魔法加号」拖到列表里任意位置，新待办就会插在你松手的地方。／ 要选中一条待办，把它向左滑。／ 在任意列表里下拉即可开始搜索。
- 具体做法（可核对）：该页把 Things 的手势逐条列成「动词 + 对象 + 结果」的短句（swipe right to bring up When、tap and hold on a list to grab it）；按该页描述，这些手势在界面上都对应一个可见控件或标签（Magic Plus、When 标签、搜索框）。它的教学方式是「在手势旁边常驻一个能被认出的对象」，而不是弹说明。
- 对 Dream 的可用点：抽屉与语音也要各配一个「能被认出的对象」——左缘一条 2–3px 的接缝/把手，输入框右侧一个常驻麦克风图标；长按语音的提示文案可以照 Things 的句式写成「按住说话，松开发送」这种动宾短句，而不是「试试长按输入框」。
- 不适用点：Things 是原生 iOS 应用，没有 Android 系统返回冲突；它的手势清单放在帮助页，等于承认「手势本身不可发现」，Dream 不能只学它的清单、不学它的常驻示能。

### 来源 7：Linear · A calmer interface for a product in motion
- URL：https://linear.app/now/behind-the-latest-design-refresh
- 抓取日期：2026-11-25
- 章节：设计刷新说明（原则段，2026-03-12 发布）
- 原文（verbatim，1–3 句）：
  > Don't compete for attention you haven't earned.
  >
  > Structure should be felt not seen.
- 直译：不要争夺你还没赚到的注意力。／ 结构应该被感觉到，而不是被看见。
- 具体做法（可核对）：该文说明侧栏被压暗、边框变柔、分隔线减少，让内容区成为唯一高对比区域。与手势/时间锚点只有间接关系：它支持「分隔条应当是低对比的次要元素」这一判断。
- 对 Dream 的可用点：日期分隔条用次要文字色（对比度 4.5:1 下限附近，不要再高），不加边框、不加背景块，只在垂直方向留 16dp 呼吸；不要做成一条全宽分隔线。
- 不适用点：Linear 是桌面宽屏、鼠标优先的产品，没有触摸热区与系统返回手势的问题；「减少分隔线」在长会话里会直接损害可扫描性，不能照搬到时间锚点。

## 二、时间锚点

### 来源 8：MUI X Chat · Date divider（组件规范）
- URL：https://mui.com/x/react-chat/display/date-divider/
- 抓取日期：2026-11-25
- 章节：Chat → Display → Date divider
- 原文（verbatim，1–3 句）：
  > The date divider appears between messages whose createdAt values fall on different calendar days.
  >
  > A divider appears above a message only when its createdAt falls on a different UTC calendar day than the previous message's. The first message in a thread never gets a divider, and single-day conversations render no dividers at all — the component returns nothing rather than an empty rule.
- 直译：当两条消息的 createdAt 落在不同的日历日时，日期分隔出现在它们之间。／ 只有当某条消息的 createdAt 与上一条不在同一个 UTC 日历日时，它上方才出现分隔；会话的第一条消息永远没有分隔；单日会话完全不渲染分隔——组件返回空，而不是一条空的分隔线。
- 具体做法（可核对）：默认文案是 `date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })`，英文环境渲染成 "May 3, 2026"；分隔元素带 `role="separator"`；可用 `shouldShowDivider` 与 `formatDate` 覆写。注意它按 UTC 日界切分——这是库的实现选择，不是通用规范。（该页正文由 JS 渲染，同日复查只返回标题；上述原文与 API 名取自当天首次抓取的正文，按 B 级使用。）
- 对 Dream 的可用点：三条可直接搬的规则——(1) 首条消息上方不插分隔；(2) 单日会话一条分隔都不插（不要留空白节点，会导致 ListView 里 0 高度 item）；(3) 分隔节点要给语义标签（Flutter 里 `Semantics(label: '2026年11月25日')`），否则读屏会把它当普通文本。
- 不适用点：UTC 日界在 UTC+8 会把 08:00 之前的消息算到前一天，中文用户早上 7 点的消息会被标成「昨天」——必须改用本地时区；"May 3, 2026" 的月名格式在中文里不成立。

### 来源 9：Slack 的日期分隔（第三方实测，B 级，未取得官方原文）
- URL：https://slack.green/en/blog/slack-jump-to-date
- 抓取日期：2026-11-25
- 章节：正文第 1–2 节（The menu changes with the channel / The divider is only above each day），2026-10-05 发布
- 原文（verbatim，1–3 句）：
  > To jump to a date in a Slack channel, click the date divider above a day's messages (it reads "Today" or a date like "Friday, October 2nd") and choose Jump to a specific date.
  >
  > In the 500-message channel every message was from the same morning, so there was one divider, above message 1. While we were reading messages 410 to 439 and at message 500, the page had no date divider at all, so the menu could not be opened.
- 直译：要在 Slack 频道里跳到某个日期，点击某天消息上方的日期分隔条（上面写「Today」或「Friday, October 2nd」这样的日期），再选 Jump to a specific date。／ 在那个 500 条消息的频道里，所有消息都来自同一个上午，所以只有一条分隔条，在第 1 条消息上方。当我们读到第 410–439 条、以及第 500 条时，页面上根本没有日期分隔条，菜单也就打不开。
- 具体做法（可核对）：Slack 的规则是「每天只在当天第一条消息上方插一条分隔，跨天才插，同日不按间隔重复插」；文案两种形态——相对词 "Today" 与完整日期 "Friday, October 2nd"（含星期 + 月 + 序数日）。分隔条同时是交互入口（点击弹 Jump to date 菜单），不是纯装饰。作者在免费版实测，同一工作区两个频道（一个 3 天没消息、一个机器人刚灌 500 条）。
- 对 Dream 的可用点：日期分隔同时承担「锚点」与「入口」两职——Dream 可以点日期分隔跳到该日第一条（后续做「按日期定位」时零成本）；文案用「今天 / 昨天 / 11月20日 周四」三段式，与 Slack 的相对词 + 完整日期同构。
- 不适用点：Slack 是桌面宽屏、按天分组的团队工具，不显示每条消息的时分（时间在 hover 里）；聊天 App 里用户需要更细粒度的锚点，只按天分隔不够。该文也没给出「同日间隔多久再插一条」的阈值——Slack 根本没有这个规则。

### 来源 10：iMessage 的时间戳与日期标签（B 级，教程站转述）
- URL：https://www.techbloat.com/how-to-check-the-timestamp-of-messages-on-iphone.html
- 抓取日期：2026-11-25
- 章节：How Message Timestamps Work on iPhone / How to View the Exact Time of Individual Messages（2026-05-17）
- 原文（verbatim，1–3 句）：
  > The date separators are the labels you see between clusters of messages, such as Today, Yesterday, Mon, Jan 8, or a full date for older conversations.
  >
  > In a conversation, swipe left across the message area and hold your finger on the screen to uncover a column of times on the right side.
- 直译：日期分隔就是你在消息组之间看到的标签，比如今天、昨天、周一 1月8日，更老的会话则是完整日期。／ 在会话里，在消息区上向左滑并按住屏幕，右侧会露出一列时间。
- 具体做法（可核对）：该文描述 iMessage 的两种时间呈现——**可见的日期分隔**（Today / Yesterday / Mon, Jan 8 / 完整日期，出现在每组消息上方）与**隐藏的逐条时间**（左滑并按住，右侧浮出与每条气泡对齐的时间列，松手即消失）。同一组消息共用一个日期标签（文中例子：整组显示 "Yesterday 9:41 PM"，组内各条实际是 9:41/9:43/9:44/9:50）。文中还提醒：长按气泡会打开消息菜单，不会显示时间列。
- 对 Dream 的可用点：iMessage 把「粗粒度锚点」做成常驻可见、把「精确时间」做成按需出现——Dream 可以照此分层：日期分隔常驻，单条消息的 HH:mm 只在长按气泡菜单里显示（Dream 已有长按菜单，零新增手势）。**不要**照搬「左滑按住看时间」：这正是 HIG 反对的「隐藏且是唯一途径」。
- 不适用点：这是教程站的二手描述，不是 Apple 官方文档，日期标签的确切规则（几天内显示星期、何时升级为完整日期）文中没有给阈值；原文也没说分隔是否按「间隔」而非「跨天」触发，不能据此推断。

### 来源 11：腾讯云 IM UIKit · TimeDividerConfig.timeInterval（中文语境，A 级）
- URL：https://pub.dev/documentation/tencent_cloud_chat_uikit/2.7.2/ui_views_TIMUIKitChat_tim_uikit_chat_config/TimeDividerConfig/timeInterval.html
- 抓取日期：2026-11-25
- 章节：TimeDividerConfig 类 → timeInterval 属性（2.7.2 文档）
- 原文（verbatim，1–3 句）：
  > Defines the interval of adding a time divider among the two messages. Unit: second. Default: 300.
- 直译：定义在两条消息之间插入时间分隔的间隔。单位：秒。默认值：300。
- 具体做法（可核对）：腾讯云 IM 的默认策略是**按间隔**而非按天：相邻两条消息间隔超过 300 秒（5 分钟）就插一条时间分隔。这是中文聊天 SDK 的默认值，说明「5 分钟」在中文语境里是被产品验证过的阈值，与 Slack 的「只跨天」是两套策略。
- 对 Dream 的可用点：采用「跨天必插 + 同日间隔 ≥5 分钟插」的双条件：日界保证日期锚点，5 分钟阈值保证长会话里时间可定位；两条规则都只依赖上一条消息的本地时间，可在 ListView 构建时 O(1) 判断。
- 不适用点：文档只给默认值，没给文案格式（是否显示「昨天」「今天」），也没说阈值是否随会话长度变化；5 分钟对高频对话会产生过多分隔条，需要在小屏上再收（见不成立的情况）。

### 来源 12：Material Design 2 · Data formats（未取得原文）
- URL：https://m2.material.io/design/communication/data-formats.html
- 抓取日期：2026-11-25
- 章节：Communication → Data formats（设计稿目录里存在该条目，正文未渲染）
- 原文（verbatim，1–3 句）：未取得原文，仅转述——页面只能取到导航目录，正文由 JS 渲染，抓取与浏览器打开均只返回 "Material Design" 标题与左侧导航；本次在 M3 站内也未能找到「聊天时间戳/日期格式」章节。
- 直译：不适用。
- 具体做法（可核对）：M2 的 Communication 分类下确有 Data formats、Onboarding、Empty states 等条目（导航文本可见），说明该分类下确实规划过「数据格式」条目；但正文不可达，本文件不据此下任何结论。
- 对 Dream 的可用点：无（不使用 C 级材料）。时间锚点的具体数字全部取自 MUI、Slack 实测与腾讯 SDK 文档。
- 不适用点：本条只用于说明「Material 没有可引用的聊天时间戳规范」，不能反过来当作「Material 反对时间分隔」的证据。

## 综合判断

**手势（3 条，全部落到可量尺寸）**

1. **保留左缘右滑，但必须补一个可见入口，且热区不能吃掉系统返回。** HIG 要求自定手势「不是重要动作的唯一途径」，Android 的预测式返回又把左右边缘滑走征用了。做法：聊天页 AppBar 左侧常驻一个 44×44pt（Android 上 48×48dp）的会话按钮，距左 8dp、垂直居中；边缘拖拽热区在 iOS 保持 44pt，在 Android 收窄到 20dp 以内，并改用「从内容区任意位置向右拖 40dp 后接管」；抽屉展开动画 280ms、退出 220ms（沿用 docs/design/02 的曲线 cubic(0.2,0,0,1)）。会话按钮的语义标签写「打开会话列表」，不要写「抽屉」。

2. **长按输入框进语音降级为「加速器」，语音必须有常驻按钮。** HIG 的 "Touch (or pinch) and hold = Reveal additional controls" 允许长按唤起附加能力，但 Context menus 条要求「主界面也要有」。做法：输入框右侧常驻 44×44pt 麦克风按钮（点按 = 开始/结束录音，长按 = 按住说话，复用现有 onLongPressStart / onLongPressEnd）；长按输入框仍然进语音，但它只是把手指从右侧移到输入框上，省一次位移；录音中松手发送、上滑超过 44pt 取消、取消区文案「上滑取消」，录音态给 10% 状态层 + 120ms 按压反馈（Material state layer 的 Press 值）。

3. **教学只做一次，且必须贴在发生地。** 沿用现有 `'dream-gesture-hint-seen'` 一次性标记与 4s 自动消失（符合 HIG「跳过之后不再弹」），但把 hint 从屏幕中部改成两处就近显示：会话抽屉的 hint 贴在左缘内侧 12dp、距顶 96dp；语音 hint 贴在输入框上沿 8dp 处。文案用动宾短句、≤14 个汉字：「向右滑，打开会话」「按住说话，松开发送」。设置页增加一行「手势说明」（行高 ≥44pt，右侧 chevron），作为「之后想看时容易找到」的出口。

**时间锚点（4 条，给阈值与文案）**

1. **跨天必插日期分隔，按本地时区日界，首条不插。** 判定：`msg.time` 与上一条的本地日期（`DateTime(y,m,d)`）不同即插；会话第一条不插；单日会话零分隔（MUI 的两条规则）。实现上把日期分隔作为「当天第一条消息 item」的前置子节点渲染，不要为分隔单独生成 0 高度 item——`ListView.builder` 的 index 会因此错位，`jumpTo` 与「跳到最新」都会偏。

2. **同日按 5 分钟阈值插时间分隔，并带自适应上限。** 基础阈值取 300 秒（腾讯云 IM 默认值）：相邻两条本地时间差 >5 分钟才插，且插的是「时间」不是「日期」。上限：若某个 1 小时窗口内已经插了 4 条，则本窗口阈值升到 15 分钟（否则 6 分钟一条的对话一小时会插 10 条）；窗口滚动时阈值复位。

3. **文案分两套：跨天锚点带日期（+首条时间），同日锚点只带时间。** 跨天分隔（当天第一条消息上方）：当天首条「今天 14:32」、昨天「昨天 09:15」、7 日内「周四 09:15」、同年更早「11月20日」、跨年「2025年11月20日」——参照 iMessage 的分组标签会把日期与时间写在一起。同日 5 分钟分隔：只写「14:32」。统一 24 小时制、字号 12sp、次要文字色、上下间距 16dp、居中；分隔条本身不加背景、不加边框（Linear 的 "Structure should be felt not seen"）。

4. **精确时间按需出现，不做隐藏手势。** 单条消息的 HH:mm 放进已有的长按菜单（复制/编辑/重新生成之上，作为不可点的说明行），而不是新造「左滑看时间」。若要做滚动时的当前日期提示，用 AppBar 副标题（12sp，次要色）显示当前可见范围首条的日期，滚动停止 800ms 后更新——这是推断，无原文依据，需实测再定。

## 不成立的情况

- **iOS 左缘右滑会与系统返回打架。** HIG 明确要求 "Avoid conflicting with gestures that access system UI"；iOS 上从左缘起手的滑动是系统返回，WebView/Flutter 壳里 Dream 的 44pt 热区会把返回手势吞掉，用户会觉得「返回失灵」。要么把热区压到 20pt 以内并只响应「慢速拖拽」，要么在 iOS 上彻底改成「点会话按钮」。
- **Android 手势导航下边缘热区更紧。** Material 的预测式返回把左右边缘都算作返回起点，`drawerEdgeDragWidth: 44` 在 360dp 宽的机器上约占屏宽 12%，两者重叠时系统优先，抽屉会「时灵时不灵」。
- **UTC 日界在中文时区会切错。** MUI 的 UTC 规则意味着东八区 08:00 前的消息被算进前一天；Dream 必须用设备本地时区，否则早上 7 点的对话会被标成「昨天」。
- **「今天/昨天」直译在跨年、跨时区时失效。** 12 月 31 日 23:50 与 1 月 1 日 00:10 的消息，一个显示「昨天」会指向去年；用户在飞机上跨时区后，所有「今天」都可能错位。跨年必须补年份。
- **5 分钟阈值在高频对话 + 小屏上会失控。** 360×640 的机器键盘弹起后可视高度不足 300dp，一条分隔条 + 16dp 上下间距会吃掉 44dp，两三条就把一屏挤满；低端机上频繁插入/移除分隔还会让 `ListView.builder` 的 index 映射抖动，`jumpTo` 落点偏移。
- **Slack 式「Friday, October 2nd」不能直译。** 中文没有序数词后缀，写成「10月2日 星期五」会变长；且 Slack 是宽屏，分隔条能容纳 15 个字符，Dream 的小屏居中分隔建议 ≤10 个汉字。
- **iMessage 的「左滑按住看时间」是反面教材。** 它隐藏且是看精确时间的唯一途径，违反 HIG 的 Discoverable 与「不是唯一途径」，在 Dream 里照搬会制造第二个不可发现手势。

## 抓取记录

成功打开（HTTP 200，正文可读）：

1. https://developer.apple.com/design/human-interface-guidelines/gestures
2. https://developer.apple.com/design/human-interface-guidelines/context-menus
3. https://developer.apple.com/design/human-interface-guidelines/onboarding
4. https://m3.material.io/foundations/interaction/gestures （首次抓取返回正文；同日复查仅返回标题 "Gestures – Material Design 3"，正文未渲染）
5. https://m3.material.io/foundations/interaction/states/state-layers （首次抓取返回正文；同日复查仅返回标题，正文未渲染）
6. https://culturedcode.com/things/support/articles/2803582/
7. https://linear.app/now/behind-the-latest-design-refresh
8. https://mui.com/x/react-chat/display/date-divider/ （首次抓取返回正文；同日复查仅返回标题 "Date divider - MUI X"，正文未渲染）
9. https://slack.green/en/blog/slack-jump-to-date
10. https://www.techbloat.com/how-to-check-the-timestamp-of-messages-on-iphone.html
11. https://pub.dev/documentation/tencent_cloud_chat_uikit/2.7.2/ui_views_TIMUIKitChat_tim_uikit_chat_config/TimeDividerConfig/timeInterval.html

失败项与替代来源：

- https://www.macobserver.com/ios/ios-7-messages-time-stamp/ → 403（Cloudflare 拦截）。替代：来源 10 的教程站（B 级）。
- https://slack.com/help/articles/202026038-Read-messages → 被重定向到 Slackbot 帮助文章，正文无日期分隔内容。替代：来源 9 的第三方实测（B 级）。
- https://getstream.io/chat/docs/sdk/react/v15/component-reference/message/dateseparator.md → 404（Stream Chat SDK 文档已改版）。替代：来源 8 的 MUI X Chat 规范页。
- https://m3.material.io/components/navigation-drawer/overview → 页面 body 为空（客户端渲染未出内容），未取得原文。未使用。
- https://m2.material.io/design/communication/data-formats.html → 只返回 "Material Design" 与左侧导航，正文 JS 渲染不可达；浏览器打开同样为空。记为「未取得原文」，不进入结论（见来源 12）。
- https://web.archive.org/web/2019id_/https://material.io/design/communication/data-formats.html → 抓取器拒绝（hostname 解析到非公网地址），无法作为替代。
