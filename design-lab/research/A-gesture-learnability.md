# A · 隐藏手势如何被学会

> 研究问题：Dream「左缘右滑开抽屉」「长按输入框进语音」这两个隐藏手势，首次提示放在哪、何时出现、何时消失、出现几次。
> 结论只从下列原文推出；未取得原文的地方已标注。

## 来源 1：Memory Recognition and Recall in User Interfaces
- URL：https://www.nngroup.com/articles/recognition-and-recall/
- 抓取日期：2026-11-25
- 章节/位置：正文「Promote Recognition in User Interfaces → Visible, Intuitive Chrome」
- 原文（verbatim，1–3 句英文）：
  > Gestural interfaces also rely heavily on recall because they require users to remember the gestures that they can make in a given context. Tips, progressive disclosure, and good gestural signifiers are all cues meant to make the recall of the gesture easier.
  >
  > People are supposed to memorize that information and remember it when they need it. That’s not going to happen: tutorials have a lot of information, but they are not rehearsed much and users have little time to establish associations between the information in the tutorial and the actual interface. Instead of showing general tutorials, use contextual tips tailored to the page that the user is visiting.
- 直译：手势界面高度依赖回忆，因为用户必须自己记住在某个上下文里能做哪些手势。提示、渐进披露和好的手势示能，都是为了让「回忆手势」变容易的线索。／ 人们被指望把这些信息背下来、在需要时想起来。这不会发生：教程信息量大，却没有被反复练习，用户也没时间在教程信息和真实界面之间建立联想。不要给通用教程，给针对用户当前所在页面的上下文提示。
- 我的解读：这里有三个可直接用的判断。第一，手势界面被本篇与命令行、登录并列点名为「重度依赖回忆」的界面类型，它的默认失败模式不是用户笨，而是检索线索太少。第二，作者给的三条解法是并列的——提示（tip）、渐进披露、示能（signifier）——意味着「弹一句话」只是三分之一，另外三分之二是让手势在界面上留下可见痕迹。第三，通用教程失败的原因是「没有练习、没有与界面建立联想」，所以提示必须和界面位置绑定，而不是和启动流程绑定。
- 对 Dream 的可用点：抽屉与长按语音的提示文案必须贴在对应界面元素上（左缘 / 输入框），不能做成首启欢迎页；同时必须给手势配一个静态示能（左缘接缝、麦克风旁的波形图标），让用户即使没读过提示也能「认出」。
  - 不适用点：本篇是理论综述，没给出提示的时长、次数、像素位置；这些数字必须从来源 5/6/7 与实测拿。

## 来源 2：Progressive Disclosure
- URL：https://www.nngroup.com/articles/progressive-disclosure/
- 抓取日期：2026-11-25
- 章节/位置：开篇定义 / 「Usability Criteria for Progressive Disclosure」
- 原文（verbatim，1–3 句英文）：
  > Initially, show users only a few of the most important options. Offer a larger set of specialized options upon request. Disclose these secondary features only if a user asks for them, meaning that most users can proceed with their tasks without worrying about this added complexity.
  >
  > It must be obvious how users progress from the primary to the secondary disclosure levels: […] Second, label the button or link in a way that sets clear expectations for what users will find when they progress to the next level.
- 直译：初始只展示少量最重要的选项；更专业的功能按需提供；只有当用户主动要求时才披露次级功能，这样大多数用户可以在不操心这些复杂度的前提下完成任务。／ 必须让「如何从主层级进入次层级」显而易见：……第二，给按钮或链接起一个能明确预期下一层内容的名字。
- 我的解读：渐进披露解决的是「默认状态该露出多少」，它给出的判据不是「好看」而是「可推进性」——隐藏可以，但**进入下一层的动作必须自明，且入口要有强的 information scent**。对手势而言这是最严的一条：手势本身就是那个「入口」，如果入口不可见，披露链在第一环就断了。所以渐进披露只能解释「不要把抽屉内容全摊开」，不能替手势的可发现性背书。
- 对 Dream 的可用点：会话抽屉内部可以分层（最近会话 → 归档/搜索），但「打开抽屉」这一层不能藏到需要用户猜。设置里的手势开关、帮助页里的手势清单，是这条原则要求的「按需披露」出口。
  - 不适用点：本篇写于 2006 年，通篇是菜单/对话框语境，没有触碰触屏手势；不要把它当作「隐藏手势合理」的论据，它恰恰要求入口可推进。

## 来源 3：Onboarding（Apple Human Interface Guidelines）
- URL：https://developer.apple.com/design/human-interface-guidelines/onboarding
- 抓取日期：2026-11-25
- 章节/位置：「Best practices」
- 原文（verbatim，1–3 句英文）：
  > Consider providing a collection of context-specific tips instead of a single onboarding flow. Integrating contextually relevant tips into your experience can help people learn about their current task while they make progress in your app or game.
  >
  > When you have instructional content that refers to a specific area of the interface, display these instructions near that area.
  >
  > Teach through interactivity. People tend to grasp and retain information better when they can actually perform the task they’re learning about instead of just viewing instructional material.
- 直译：考虑提供一组「上下文相关的小提示」，而不是单一的开场引导流程。把与情境相关的提示嵌进体验里，能让人在推进当前任务的同时学会它。／ 当说明内容指向界面的某个具体区域时，把这些说明显示在那个区域附近。／ 通过交互来教。相比只看说明材料，人真正动手做一遍时更容易理解和记住。
- 我的解读：这是平台方给出的、与 Dream 场景最贴的一条：**位置（near that area）+ 形态（一组小提示而非一个流程）+ 学习机制（动手做）**。它同时否掉了全屏蒙层（那是「single onboarding flow」）和顶部 toast（不在手势发生处）。「Teach through interactivity」还隐含了一个消失条件：用户做过一次，教学目的就已达成。
- 对 Dream 的可用点：抽屉提示贴左缘、语音提示贴输入框上沿；整个引导拆成两条独立小提示，各自独立计数、互不阻塞；用户成功做出手势后立即撤掉对应提示。
  - 不适用点：HIG 是原则性条款，未给时长/次数/字号；且它默认平台已有大量系统级手势习惯（边缘返回、长按），Dream 是 WebView 壳，用户的手势肌肉记忆不一定成立，需要更保守的曝光次数。

## 来源 4：The Coming Age of Calm Technology
- URL：https://calmtech.com/papers/coming-age-calm-technology.html（重定向至 https://calmtech.com/papers/coming-age-calm-technology）
- 抓取日期：2026-11-25
- 章节/位置：「Calm Technology → The Periphery」
- 原文（verbatim，1–3 句英文）：
  > Calm technology engages both the center and the periphery of our attention, and in fact moves back and forth between the two.
  >
  > A calm technology will move easily from the periphery of our attention, to the center, and back.
  >
  > First, by placing things in the periphery we are able to attune to many more things than we could if everything had to be at the center. Things in the periphery are attuned to by the large portion of our brains devoted to peripheral (sensory) processing. Thus the periphery is informing without overburdening.
- 直译：平静技术同时作用于注意力的中心与边缘，并在两者之间来回移动。／ 一项平静的技术能轻易地从注意力边缘进入中心，再退回边缘。／ 第一，把东西放在边缘，我们能「调谐」到远比「一切都必须在中心」更多的事物；边缘由大脑中负责外周（感觉）加工的大部分区域来处理。因此边缘是「告知而不压垮」。
- 我的解读：这篇给了 Dream「不遮挡内容」诉求的理论根据：提示不必抢占中心，它可以先待在边缘（左缘的一道细缝、输入框上方一条淡影），被需要时再进入中心。关键在于「能来回移动」——边缘提示必须有一个明确的、低成本的升级路径（点一下/滑一下），否则它只是装饰。反面也清楚：如果提示永远停在中心（蒙层、弹窗），它就不是 calm，而是打断。
- 对 Dream 的可用点：抽屉提示的默认态做成左缘 2–3px 的「接缝 + 微光」（periphery），首次才升级为一次短暂的居中文案（center），随后退回接缝；这正好满足「不遮挡内容」。
  - 不适用点：Weiser 讨论的是普适计算时代的注意力经济，不提可发现性与学习曲线；且文中明说「平静」不适用于以刺激为目的的产品（见「反例与边界」），不能无限外推。

## 来源 5：Instructional Overlays and Coach Marks for Mobile Apps
- URL：https://www.nngroup.com/articles/mobile-instructional-overlay/
- 抓取日期：2026-11-25
- 章节/位置：「Short, Focused Tips」「Avoid Chains of Tips」「Do Not Match the UI」
- 原文（verbatim，1–3 句英文）：
  > Because users cannot read the hint overlay and use the app at the same time, they are forced to memorize the instructions and then apply them. Unfortunately, our short-term memory cannot retain very much information, and that information fades in about 20 seconds […]
  >
  > Presenting hints one-by-one, at the right moment, makes it a lot easier for users to understand and learn instructions. This interaction pattern has the added benefit of teaching the user at which point in the workflow these interactions or functions become applicable.
  >
  > On the Ness app for iPhone, similar styles are used on both the overlays for coach marks and for power-user features reached through hidden gestures. This similarity can easily create confusion, as users may not be able to distinguish between help and actual interface widgets.
- 直译：因为用户无法一边读提示浮层一边用应用，他们被迫先背下说明再照做。可惜短时记忆存不了多少，信息约 20 秒就衰减。／ 一次一条、在恰当的时刻给出提示，会让用户更容易理解和学会；这种模式还有个好处——它教会用户「这个交互在工作流的哪个节点才适用」。／ 在 iPhone 的 Ness 应用里，教练层浮层和「通过隐藏手势才能到达的高级功能」用了同一种视觉风格。这种相似会造成混淆，用户分不清哪些是帮助、哪些是真实控件。
- 我的解读：这条把「为什么隐藏手势 + 文字提示经常失败」讲透了：提示与操作不能同时进行，用户必须在脑内搬运说明，而搬运窗口只有约 20 秒——所以任何超过一行的提示在真实使用时刻已经失效。同时它给出了两个精确的设计约束：**一次只教一个动作**，以及**提示的视觉必须和真实 UI 明显不同**，否则用户会去点提示本身（Ness 的隐藏手势案例正是 Dream 的同构风险：左缘滑出的抽屉如果和提示长得一样，用户会以为提示可点）。
- 对 Dream 的可用点：一条提示只对应一个手势，绝不同屏同时出现「左滑」和「长按」；提示用虚线描边/手写体/半透明，与抽屉和输入框的真实控件区分；单条文案控制在一行。
  - 不适用点：该文 2014 年、面向原生 App，假定手势是「不常用但值得教」的附加功能；Dream 的抽屉是主入口之一，不能按「可选高级功能」的强度来教。

## 来源 6：Onboarding Tutorials vs. Contextual Help
- URL：https://www.nngroup.com/articles/onboarding-tutorials/
- 抓取日期：2026-11-25
- 章节/位置：「Why Tutorials (and Push Revelations) Don’t Work」「What Works: Pull Revelations」「Guidelines for Implementing Pull Revelations」
- 原文（verbatim，1–3 句英文）：
  > The guidance that tutorials provide, while potentially helpful, is hard to remember when the user needs it. The tutorial shows information out of context, and users would have to memorize it to use it when applicable.
  >
  > Pull revelations are help content triggered by some signal that the user would benefit from that information at that moment.
  >
  > Make it easy to dismiss (and recall) the help content. Being able to get rid of a (momentarily) unhelpful overlay is absolutely critical, but so is the ability to find this information again later, when it is actually useful.
- 直译：教程提供的指引虽然可能有用，但用户在真正需要时很难想起来——教程脱离上下文展示信息，用户必须背下来才能在适用时用上。／ 拉式揭示（pull revelation）是由某个信号触发的帮助内容，该信号表明用户此刻会从这条信息中受益。／ 让帮助内容易于关闭（并且可以再找回）。能清掉一个（此刻）无用的浮层是绝对必要的，但同样必要的是：在之后真正有用的时候还能重新找到这条信息。
- 我的解读：这是四个问题里第 2、3 问的核心依据。「Pull」的定义把「何时出现」从**时间轴**（第几次启动）改成了**意图信号**（用户此刻正在做相关的事）。第三条则给出了消失机制的正确结构：**dismiss 与 recall 必须成对**——只做「关掉就永别」会让忘记的用户无从找回，只做「关不掉」则变成骚扰。对本任务的含义是：提示的消失不应只有一个条件（定时），而应是「做过 / 点掉 / 超时」三条路，且每一条都留一个可再发现的入口。
- 对 Dream 的可用点：抽屉提示的触发信号定为「用户在聊天页停留且会话数 ≥ 2」（说明有切换会话的需求），而不是「第 1 次冷启动」；提示右上角给一个 24×24 的可点关闭区；帮助/设置页保留「手势说明」条目，让 dismiss 之后仍可 recall。
  - 不适用点：该文举的 Clippy 失败案例说明「猜意图」很容易猜错（原文：失败源于「intrusive and didactic nature of the revelations」与不可靠的模式匹配）——所以 Dream 的触发信号只能用「页面 + 停留时长」这类低风险信号，不要做行为预测式的主动弹出。

## 来源 7：Mobile Tutorials: Wasted Effort or Efficiency Boost?
- URL：https://www.nngroup.com/articles/mobile-tutorials/
- 抓取日期：2026-11-25
- 章节/位置：「Methodology」「Key Findings」
- 原文（verbatim，1–3 句英文）：
  > We observed comparable task success rates for the two conditions. Task success across the four apps tested was 91% for the those who read the tutorial (n=35) and 94% for those who skipped the tutorial (n=35). This difference was not statistically significant (p=0.443)
  >
  > Across all the apps, group A, who read the tutorials (n=35), had an average SEQ of 4.92 while group B, who skipped tutorials (n=35), had an average SEQ of 5.49. This difference was statistically significant (p=0.047).
- 直译：两种条件下的任务成功率相当。四个被测应用中，读了教程的人成功率为 91%（n=35），跳过教程的人为 94%（n=35），差异无统计显著性（p=0.443）。／ 所有应用中，读教程组的平均 SEQ（易用性自评，1–7）为 4.92，跳教程组为 5.49，差异有统计显著性（p=0.047）。
- 我的解读：这是本组来源里唯一的定量证据，结论很硬：开屏教程**没有**提升成功率，也**没有**缩短时间（原文另给：93.49s vs 85.17s，不显著），反而让用户**觉得更难**（低 0.57 分，显著）。它的样本是 70 人、4 个 App 的 deck-of-cards 教程，属于「启动即教」而非「上下文提示」，所以不能直接判 Dream 的提示无效；但它足以否掉「首启全屏引导」这个方案，也解释了为什么「教程让人以为 App 很复杂」。
- 对 Dream 的可用点：不要做首启全屏手势教程；如果一定要有一次「集中教学」，只能放在用户主动打开的帮助页里，且不计入自动曝光次数。提示的成效指标应看「手势首次成功使用率 / 到首次使用的时间」，而不是「提示阅读率」。
  - 不适用点：该研究只测了 deck-of-cards 教程，未测「边缘微提示」；91%/94% 的任务本身较简单，不能外推到复杂手势；样本为 iOS 熟练用户。

## 综合判断

1. **位置：贴在手势发生处，不做全局蒙层。** Apple 明写「说明指向界面某个区域时，就显示在那个区域附近」，NN/g 也要求「针对当前页面的上下文提示」。落到像素：抽屉提示做成贴左缘、垂直位于屏幕高度 30%–35% 处、宽 44pt 的竖条（离左边缘 0pt，右侧圆角 4pt），文案横向排列、限定一行；语音提示贴输入框上沿 8pt、水平居中于输入框，箭头指向麦克风图标。绝不用覆盖全屏的蒙层——那同时违反 Apple 的「context-specific」与 Weiser 的「不要一切都在中心」。

2. **出现时机：由「用户此刻会受益」的信号触发，不由「第几次启动」触发。** Laubheimer 对 pull revelation 的定义是「由某个信号触发的帮助内容，该信号表明用户此刻会受益」。Dream 可用的低风险信号只有两类：抽屉——进入聊天页后停留 ≥ 1.5 秒且会话数 ≥ 2 且从未成功开过抽屉；语音——输入框已聚焦 ≥ 2 秒且从未成功进入过语音。冷启动第一帧不弹（那正是 Kendrick 测出「让人觉得更难」的场景），启动完成后再等上述条件。

3. **消失：三条终止路径，缺一不可。** ①用户成功做出一次手势 → 该提示永久不再自动出现（Apple「Teach through interactivity」：做过即学会）；②用户点掉（关闭区 ≥ 24×24pt）→ 本次不再出现，但保留在帮助页（Laubheimer：dismiss 与 recall 必须成对）；③无任何操作 → 4 秒后淡出，本次会话内不再出现，但**不算**永久消费（Weiser 的边缘提示本就不该要求即时响应；NN/g 给出短时记忆约 20 秒的衰减窗口，4 秒足以读完一行，又不会滞留成遮挡）。定时消失永远只用于「轻度/边缘」形态，不能作为唯一机制。

4. **次数：总自动曝光 ≤ 3 次，且按「冷启动」而不是「页面切换」计数。** 依据是 Kendrick 的显著结果——教程组自觉更难（4.92 vs 5.49），连续提示会累积「这 App 很复杂」的印象；Harley 则用「shot glass, not beer tankard」形容每条提示的容量。具体：同一手势最多自动出现 3 次，两次之间至少隔 1 次冷启动；第 3 次之后停止文字提示，只保留静态示能（左缘接缝 / 麦克风波形图标），不再动画、不再文案。

5. **一次只教一个动作，且提示必须长得不像真控件。** Harley：短时记忆约 20 秒、一次读不完就用不上；且「hint 与真实控件同风格会造成混淆」（Ness 的隐藏手势案例）。所以抽屉与语音的提示不同屏、不同时出现，各自独立计数；视觉上用虚线描边 + 半透明底 + 非系统字体，与抽屉面板、输入框做出明确区分，避免用户去点提示本身。

6. **长期解法是把「回忆」降级为「识别」：手势必须留下可见痕迹。** Budiu 把 tip、progressive disclosure、gestural signifier 并列为「让回忆变容易的线索」，Weiser 则要求提示能「从边缘进入中心再退回边缘」。落到 Dream：左缘常驻 2–3px 的接缝阴影（无动画、无文字），长按输入框时在麦克风 icon 旁显示 200ms 的波形预览——用户不需要记住「有个手势」，只需要**认出**那道缝和波形。

## 反例与边界

- **熟练用户**：上述「≤ 3 次」的计数对老用户是浪费甚至冒犯；必须用「是否成功使用过」作为硬闸门，而不是纯计数。Laubheimer 文中 Clippy 的失败正是「在用户没求助时主动出现」。
- **无障碍**：边缘右滑与长按对运动障碍、单手操作、屏幕阅读器用户不可用；VoiceOver/TalkBack 无法表达「从左缘右滑」。此时 recognition 原则失效——必须保留可见的等价按钮（左上角菜单按钮、麦克风按钮），且这些按钮不是「降级方案」而是**必需路径**。
- **低识字率 / 非中文用户**：文字提示的前提是能读懂那行字。此时应退化为动效（一次 600ms 的示意滑动）或纯图形；本文件所有「一行以内」的建议都建立在可读中文之上。
- **游戏化 / 强刺激产品**：Weiser 明确写了「A calm videogame would get little use; the point is to be excited」。Quiet Instrument 的前提是工具型、内容优先；若 Dream 未来做活动页/游戏化，本套「边缘、克制、少次数」的原则不适用。
- **手势是唯一入口时**：「不打扰」要让位于「可达」。若抽屉是切换会话的唯一方式（没有可见按钮），首次必须强制可见，宁可打扰一次也不能让用户找不到会话列表。
- **RTL 语言**：左缘手势在阿拉伯语/希伯来语下应镜像到右缘，提示位置与动画方向都要翻转，否则「贴在手势发生处」反而指错方向。
- **平台壳差异**：iOS 左缘右滑与系统「返回」手势冲突；此时手势的可学习性问题会变成「手势能否被触发」的问题，提示再好在物理上也无解，应改为顶部下拉或按钮。

## 抓取记录

成功打开并读到正文：

1. https://www.nngroup.com/articles/recognition-and-recall/ （200，正文完整）
2. https://www.nngroup.com/articles/progressive-disclosure/ （200，正文完整）
3. https://developer.apple.com/design/human-interface-guidelines/onboarding （200；JS 渲染，需等待后取正文，已取到完整「Best practices」）
4. https://calmtech.com/papers/coming-age-calm-technology.html （200，重定向到 https://calmtech.com/papers/coming-age-calm-technology，正文完整）
5. https://www.nngroup.com/articles/mobile-instructional-overlay/ （200，正文完整）
6. https://www.nngroup.com/articles/onboarding-tutorials/ （200，正文完整）
7. https://www.nngroup.com/articles/mobile-tutorials/ （200，正文完整，含 Key Findings 数据）

失败 / 改道：

- https://www.nngroup.com/articles/coach-marks/ → 404（NN/g 页面自己提示「AI 常编造不存在的 NN/g 链接」）。改用同主题的 mobile-instructional-overlay（来源 5）。
- https://www.nngroup.com/articles/onboarding-tutorials-vs-contextual-help/ → 404。改用真实路径 onboarding-tutorials（来源 6）。
- https://www.nngroup.com/search/?q=coach%20marks → 页面只渲染导航与 Cookie 弹窗，未返回结果列表。改用 web_search 定位候选 URL，再逐个用浏览器打开验证（上述 404 即由此发现）。
