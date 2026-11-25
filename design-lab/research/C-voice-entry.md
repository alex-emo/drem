# C · 语音入口

> 研究问题：聊天输入区是否应该有一个常驻的语音入口？如果有，它应该是「发送键 ↔ 麦克风键」的替换，还是与发送键并存的独立按钮？录音用按住还是点按？转写结果直接发送，还是先落进输入框？
>
> 抓取日期：2026-11-25（Asia/Shanghai）。本文所有 URL 均在这一天实际打开；HTTP 状态与改道见「五、抓取记录」。
>
> 证据边界：只读产品官方帮助/平台设计文档/公开研究，没有做真机截图、没有做可用性测试、没有做 A/B。文中的「界面惯例」与「官方规则」严格分开；官方页没有写的，不替它补。
>
> 可信度口径：A＝平台官方（Apple Support / Apple HIG / W3C）或一级研究机构（NN/g）；B＝产品官方帮助或公告（微信、Telegram、WhatsApp）、组件库规范（Material 3）、Gboard 帮助、可靠的大规模实测（Hoober）；C＝二手媒体（Macworld），只能作旁证，**不可单独支撑结论**。产品官方帮助在本报告里是 B，不升格为平台规范。
>
> 引用说明：原文中的图标在网页上常是图片，提取成文本后会变成空格。本文用 `[麦克风图标]`、`[发送图标]` 这类方括号补出图标含义；方括号内不是原文文字，除此之外均逐字照录。

## 一、问题

### 1.1 现状

Flutter 客户端 `apps/mobile_flutter` 的输入区目前没有可见的语音按钮。基线（HEAD）只有一条隐藏手势：在输入行上按住 420ms 开始录音，上滑 56pt 取消，松手后转写。

这条手势同时承担了「进入语音」「取消」「结束」三件事，但三件事都没有可见的提示。它带来三个具体问题：

1. **没有可见入口**：新用户不知道输入行可以长按录音；知道的人也要先记住 420ms 这个阈值。
2. **已聚焦时被选字抢走**：输入框聚焦后，长按是系统文本选择的标准手势；同一个长按不能同时稳定地服务「录音」和「选字」。
3. **录音后没有第二次机会**：这里需要把任务描述拆开看。代码里转写结果其实会填回输入框，并不会自动发给对方；真正缺的是「这段转写是否可信」的显式确认/撤销层，以及录音结束后的试听/重录机会。

### 1.2 代码核对（只读，未改）

我按 HEAD 和工作区各读了一次，确认「任务描述」与「当前代码」不是同一个版本：

| 版本 | 入口 | 录音触发 | 取消 | 转写落点 |
|---|---|---|---|---|
| HEAD `composer.dart` | 无麦克风按钮 | 长按输入行 420ms（`composer.dart:120-121`） | 上滑超过 `_cancelDistance = 56`（`composer.dart:63`） | `chat_screen.dart:259-267` 的 `_fillFromVoice` 填入 `_controller` |
| 工作区未提交草案 `composer.dart` | 空输入显示麦克风，有文字显示发送（`composer.dart:347-348`） | 麦克风点按开始/停止；长按输入行 420ms 作为加速器（`composer.dart:189-190`） | 点按聆听态有 X/停止；长按态只有「上滑取消」文字，没有按钮；上滑 56pt 仍在 | 仍填入输入框 |

工作区草案已经加了 `if (widget.focusNode.hasFocus) return;`（`composer.dart:181`），把已聚焦时长按让给选字；这正好对应问题②。草案的麦克风点击目标是 44×44dp，低于 Material 3 的 48dp 交互目标（见 S18）。

因此，本报告把「空输入麦克风 / 有文字发送」当作**待评估的互换方案**，而不是既成事实；同时把问题③的落点改成「转写后的确认/撤销」，而不是「把转写填进输入框」——后者代码已经做了。

### 1.3 要决定的四个变量

1. **入口形态**：常驻麦克风；空/有文字互换；微信式「语音模式」切换键；还是藏在「+」菜单里。
2. **录音手势**：按住说话（松手结束）；点按开始/再点结束；两者并存。
3. **取消与上限**：上滑取消；可见的取消按钮；录音时长上限；录完是否可以试听/重录。
4. **转写落点**：直接发送；填入输入框；填入后给确认/撤销；还是只做发送后的辅助转写。

### 1.4 结论边界

- 本文能证明「官方文档怎么写」「平台规范怎么要求」「研究机构发现了什么」，不能证明「Dream 用户一定更喜欢哪种」。
- 微信、Telegram、WhatsApp 的官方帮助是产品文档（B），不是平台规范；它们能说明「有产品这样做」，不能说明「这是标准」。
- Macworld 是 C 级，只用来提示「常驻麦克风误触是真实存在的问题」，不单独支撑任何建议。
- WCAG 是 Web 标准，Dream 是 Flutter；本文把它当无障碍设计基线引用，不做法律合规判断。

## 二、来源摘录

### 2.1 入口形态：发送键 ↔ 麦克风键（Q1）

#### S1｜How to Send a Voice Message?（微信帮助中心）

- **URL**：https://cs.help.wechat.com/hc/en-us/articles/11915240382863-How-to-Send-a-Voice-Message
- **抓取日期**：2026-11-25
- **等级**：B（产品官方帮助）
- **章节/位置**：正文「How to Send a Voice Message?」与「Note」「Tip」

**逐字原文：**

> "In the chat window, tap the voice button in the lower-left corner. This will switch the bottom bar to "Hold to Talk" mode. Press and hold the button to record your message, then release it to send."

> "Note: The maximum length for a single voice message is 60 seconds."

> "Tip: Canceling a Voice Message After Recording Has Started If you change your mind, simply slide your finger to the top-left from the button to cancel the recording."

**直译：**

> 「在聊天窗口中，点按左下角的语音按钮。这会把底栏切换为『按住说话』模式。按住按钮录制你的消息，然后松开即可发送。」

> 「注：单条语音消息的最长时长为 60 秒。」

> 「提示：录音开始后取消语音消息——如果你改变主意，只需把手指从按钮滑向左上角即可取消录音。」

**解读：**

微信不是「麦克风/发送」互换，而是**独立的语音模式切换键**：左下角有一个语音按钮，点一下把整个底栏换成「Hold to Talk」大按钮。按住录、松手即发、左上滑取消、单条 60 秒。这个例子同时回答了 Q1（微信是互换的反例）、Q2（松手即发 + 上滑取消 + 时长上限）和 Q4（松手默认发语音，转文字是另一条分支，见 S2/S7）。

对 Dream 的直接含义：如果产品要做「常驻入口」，微信的做法是「语音入口是模式切换键，不是麦克风本身」；它不占用发送键的位置，代价是多一次模式切换。

#### S2｜The Smarter Way to Talk, Now You Can Edit Voice-to-Text Before Sending!（微信新闻稿）

- **URL**：https://newsroom.wechat.com/newsRooms/NewsDetails/TheSmarterWaytoTalkNowYouCanEditVoice-to-TextBeforeSending
- **抓取日期**：2026-11-25
- **等级**：B（产品官方公告）
- **章节/位置**：正文第 1–3 段与「How to edit your voice-to-text messages」

**逐字原文：**

> "With the version 8.0.61 update, you can quickly convert your own voice to text and send it, without having to type it all out."

> "Plus, another crucial improvement is that voice-to-text conversions allow for editing before sending! This ensures the converted text accurately reflects what you want to say, which also corrects inaccuracies if the speech recognition isn’t perfect."

> "How to edit your voice-to-text messages: Open Any Chat. Tap the「Voice Message」icon, usually located at the bottom left of the chat interface. Tap「Hold to talk」and start talking. Do not release your finger, as doing so will send the voice message immediately. While still holding, swipe towards the「Convert to text」option. Once the green box appears, you can now edit the converted text. After making your desired changes, tap「Send」."

**直译：**

> 「在 8.0.61 版本更新中，你可以快速把自己的语音转成文字并发送，无需全部打字。」

> 「此外，另一项关键改进是：语音转文字后可以在发送前编辑！这能确保转换后的文字准确表达你想说的内容，也能在语音识别不够完美时纠正错误。」

> 「如何编辑语音转文字消息：打开任意聊天。点按『语音消息』图标，通常位于聊天界面左下角。点按『按住说话』并开始说话。不要松开手指，因为一松手就会立即发送语音消息。保持按住的同时，朝『转文字』选项滑动。绿色框出现后，你就可以编辑转换后的文字。完成修改后，点按『发送』。」

**解读：**

这是 Q4 最强的一条产品证据：微信的默认路径确实是「松手即发语音」，但它给了一个**录音态内的转文字分支**——仍然按住，滑向「Convert to text」，出现绿色可编辑框，编辑完再点「Send」。它不是「转写后自动发送」，也不是「转写后默默填进输入框」，而是「转写后进入一个明确的确认层」。

同时它也说明：二次确认可以是**可选的路径**，不必阻断所有录音。用户想快就松手发语音；想准就滑向转文字、编辑、再发。

#### S3｜Telegram FAQ（Sending Media and More）

- **URL**：https://telegram.org/faq
- **抓取日期**：2026-11-25
- **等级**：B（产品官方帮助）
- **章节/位置**：「Sending Media and More」→「Can I send voice and video messages?」

**逐字原文：**

> "Yes. Tap and hold the microphone icon to record a voice message. Tap the icon once to switch to the camera and record a round video message. Swipe up while recording to lock it, so you don't need to keep holding the button."

> "While recording, you can pause and continue, cut off the start or the end before sending, turn on the front flash in the dark, or make the message play only once."

> "Telegram Premium users can convert voice and video messages to text with one tap."

> "With Premium, you can choose who is allowed to send you voice and video messages in Settings > Privacy and Security."

**直译：**

> 「可以。按住麦克风图标录制语音消息。点按该图标一次可切换到相机并录制圆形视频消息。录音时上滑可锁定，这样你就不必一直按住按钮。」

> 「录音时，你可以暂停和继续，在发送前剪掉开头或结尾，在暗处打开前置闪光灯，或让消息仅播放一次。」

> 「Telegram Premium 用户可以一键把语音和视频消息转成文字。」

> 「使用 Premium，你可以在『设置 > 隐私和安全』中选择谁可以给你发送语音和视频消息。」

**解读：**

Telegram 把同一个麦克风图标分成两种时间语义：**按住 = 录音，点一下 = 切相机**。它没有把「点一下」给语音，也没有把「上滑」给取消——上滑是**锁定**，锁定后可以松开手指继续录。这和微信的「上滑 = 取消」正好相反，说明「上滑」本身没有跨产品的固定含义，必须靠文案/动效教导。

Telegram 的转文字是 Premium 的**消息级一键转换**；官方没有说明它发生在发送前还是发送后，也没有把它描述成录音中的确认层。它能支持「转写可以作为辅助」，但不能支持「转写应先确认再发」。

#### S4｜How to send voice messages（WhatsApp FAQ）

- **URL**：https://faq.whatsapp.com/657157755756612/
- **抓取日期**：2026-11-25
- **等级**：B（产品官方帮助）
- **章节/位置**：正文步骤 1–3 与录音中的操作说明；Web 版 tab

**逐字原文：**

> "1. Open an individual or group chat. 2. Click [microphone icon] and start speaking. 3. Once finished, click [checkmark icon]. While recording a voice message, you can click the X icon to cancel it. While recording, you can also click [pause icon] to pause recording or preview a draft of your message. Click [red mic icon] to continue recording within the same voice message."

**直译：**

> 「1. 打开单聊或群聊。2. 点按[麦克风图标]并开始说话。3. 说完后，点按[对勾图标]。录制语音消息时，你可以点按 X 图标取消。录音时，你也可以点按[暂停图标]暂停录音或预览消息草稿。点按[红色麦克风图标]可在同一条语音消息中继续录音。」

**解读：**

WhatsApp 官方描述的是**点按开始 → 点对勾发送**，不是按住松手即发；取消是 X，暂停/预览是独立按钮。S20 进一步说明：发送之前可以试听、删除、续录、再发送。

一个重要的限制：WhatsApp 帮助页按平台分 tab，iOS/Android 参数页仍复用同一套 "Click" 文案，没有出现 hold/release。因此这条来源只能证明「官方描述是点按 + 对勾」，不能证明真机一定是按住说话；也不能把 Web 行为直接外推到移动端。报告在对比表里把它标为「官方文案：点按 + 对勾；移动端手势未逐字证实」。

#### S5｜Send and receive audio messages in Messages on iPhone（Apple Support）

- **URL**：https://support.apple.com/en-gb/guide/iphone/iph2e42d3117/ios
- **抓取日期**：2026-11-25
- **等级**：A（平台官方）
- **章节/位置**：正文「Send an audio message」与「Tip」

**逐字原文（图标处为图片，方括号为说明）：**

> "You can record and send audio messages, along with transcripts of what’s said in the message."

> "In a conversation, tap [＋图标]. Tap Audio, then begin speaking. Tap [暂停/停止图标] to pause or end your recording, then do any of the following to your message: Send it: Tap [发送图标]. Listen to review it: Tap [播放图标]. Add to the end of it: Tap [图标] (with the message duration). Cancel it: Tap [删除图标]."

> "Tip: Send follow-up audio messages more quickly by touching and holding [麦克风图标] in the text field."

> "Audio messages are automatically transcribed in the language chosen in the sender’s Settings."

**直译：**

> 「你可以录制并发送音频消息，以及消息中所说内容的转写文本。」

> 「在对话中，点按[＋图标]。点按『音频』，然后开始说话。点按[暂停/停止图标]暂停或结束录音，然后对消息执行以下任一操作：发送：点按[发送图标]。试听检查：点按[播放图标]。追加到末尾：点按[图标]（显示消息时长）。取消：点按[删除图标]。」

> 「提示：要更快地发送后续音频消息，可以触摸并按住文本字段中的[麦克风图标]。」

> 「音频消息会按发送者『设置』中选择的语言自动转写。」

**解读：**

iOS Messages 有两条路：

1. **主路径**：`+ → Audio → 说话 → 停止 → Send / Listen / Add / Cancel`。录完先停，再决定发、听、续、删——这是 Q4「先确认再发」的 A 级平台例。
2. **快捷路径**：输入框里的麦克风，按住可以更快发后续音频消息。官方只说「按住」，没有说松手是否立即发送；不要替它补。

它同时说明「长按麦克风」可以是**快捷方式**，而不是唯一入口：主路径仍然从「+」开始，且录完有明确的确认面板。

#### S6｜Text fields – Guidelines（Material 3）

- **URL**：https://m3.material.io/components/text-fields/guidelines
- **抓取日期**：2026-11-25
- **等级**：B（组件库规范）
- **章节/位置**：「Icons」→「Voice input icon」

**逐字原文：**

> "Icons in text fields are optional. Text field icons can: Describe valid input methods such as a microphone icon; Provide affordances to access additional functionality such as clearing the content of a field; Express an error."

> "**Voice input icon** A microphone icon signifies that people can input characters using voice."

**直译：**

> 「文本字段中的图标是可选的。文本字段图标可以：说明有效的输入方式，例如麦克风图标；提供访问附加功能的入口，例如清除字段内容；表达错误。」

> 「**语音输入图标** 麦克风图标表示人们可以用语音输入字符。」

**解读：**

Material 3 明确把输入框里的麦克风定义为「语音输入方式」的可供性，而不是「按住说话」按钮。它没有规定麦克风必须常驻、必须和发送键互换，也没有规定录音手势；它能支持的是：**输入框里的麦克风图标本身是组件库认可的可见入口**，是否常驻由产品决定。

这正好是 Dream 需要的「入口可见」证据，但它不能单独决定「放哪里、多大、点按还是长按」。

### 2.2 按住说话 vs 点按切换（Q2）

#### S7｜How do I convert a voice message to text during recording?（微信帮助中心）

- **URL**：https://cs.help.wechat.com/hc/en-us/articles/11917834863247-How-do-I-convert-a-voice-message-to-text-during-recording
- **抓取日期**：2026-11-25
- **等级**：B（产品官方帮助）
- **章节/位置**：正文与「Note」

**逐字原文：**

> "To convert a voice message to text during recording, swipe your finger to the top right and release to start the conversion. WeChat will automatically recognize the language set for your account for the conversion."

> "Note: Currently, only Mandarin, English, and Cantonese are supported for conversion."

**直译：**

> 「要在录音过程中把语音消息转成文字，请把手指滑向右上角并松开，开始转换。微信会自动识别你账号设置的语言进行转换。」

> 「注：目前仅支持普通话、英语和粤语的转换。」

**解读：**

把 S1、S2、S7 放在一起，微信录音态其实有**三个方向、三个结果**：

- 不滑，松手 → 发送语音；
- 滑向左上，松手 → 取消；
- 滑向右上，松手 → 转文字，进入绿色可编辑框。

同一「松手」在不同方向上语义不同。这是一个高学习成本、高运动精度的设计；对母语用户可能形成肌肉记忆，对第一次使用或手部不灵活的用户并不友好。它支持「上滑取消」作为快捷方式，但不支持「只靠上滑取消」。

#### S8｜Use Walkie-Talkie on Apple Watch（Apple Support）

- **URL**：https://support.apple.com/en-gb/guide/watch/apd246d6eefd/11.0/watchos/11.0
- **抓取日期**：2026-11-25
- **等级**：A（平台官方）
- **章节/位置**：「Talk with Walkie-Talkie」与「Use tap to talk」

**逐字原文（省略号为原文中的省略）：**

> "Touch and hold the Talk button, then speak. ... When you’re done speaking, release the Talk button. If your friend has made themself available, Walkie-Talkie opens on their Apple Watch and they’ll hear what you said."

> "If you have difficulty keeping your finger pressed on the Talk button, you can use a single tap to talk. ... When this is on, tap once to talk, then tap again when you’re finished talking."

**直译：**

> 「触摸并按住『对讲』按钮，然后说话。……说完后，松开『对讲』按钮。如果你的朋友已将自己设为可接听，Walkie-Talkie 会在其 Apple Watch 上打开，他们会听到你说的话。」

> 「如果你难以一直按住『对讲』按钮，可以使用单点按来说话。……开启后，点按一次开始说话，说完再点按一次。」

**解读：**

这是平台官方对「按住说话」最纯粹的定义：按住 = 正在说，松开 = 对方立即听到。它同时给出了一个关键的无障碍替代：**因为有人难以持续按住，Apple 官方提供单点按切换**。

这条证据对 Dream 很重要：按住说话不是「更原生所以更好」，它是一个有明确适用场景（短句、对讲、即时）且需要无障碍替代的手势。把它作为唯一方式，平台自己都不这么做。

#### S9｜Dictate text on iPhone（Apple Support）

- **URL**：https://support.apple.com/en-gb/guide/iphone/iph2c0651d2/ios
- **抓取日期**：2026-11-25
- **等级**：A（平台官方）
- **章节/位置**：「Dictate text」与「Stop dictating」

**逐字原文（图标处为图片，方括号为说明）：**

> "With Dictation on iPhone, you can dictate text anywhere you can type it. You can also use typing and Dictation together—the keyboard stays open during Dictation so you can easily switch between touch and voice to enter text."

> "In a text field, tap to place the insertion point where you want to begin dictating text."

> "When [麦克风图标] appears near the insertion point in the text field, begin to dictate your text."

> "To stop dictating, do one of the following: Tap [麦克风图标]. Say “Stop dictation.” Remain silent for 30 seconds. Dictation stops automatically."

**直译：**

> 「使用 iPhone 上的听写，你可以在任何能输入文字的地方口述文字。你也可以把打字和听写一起使用——听写期间键盘保持打开，因此你可以在触摸和语音输入之间轻松切换。」

> 「在文本字段中，点按以放置插入点，确定开始口述文字的位置。」

> 「当[麦克风图标]出现在文本字段中的插入点附近时，开始口述文字。」

> 「要停止听写，请执行以下任一操作：点按[麦克风图标]。说『停止听写』。保持安静 30 秒，听写会自动停止。」

**解读：**

iOS 听写是**点按开/停**，不是按住；停止方式有三种（再点、语音命令、30 秒静音自动停）。结果进入当前光标处的输入框，不发送、不弹确认页——它把语音当成一种输入法，而不是一种消息类型。

这直接支持 Dream 的两个选择：点按切换；转写填入输入框，由用户自己按发送。

#### S10｜Type with your voice（Gboard 帮助）

- **URL**：https://support.google.com/gboard/answer/2781851?hl=en&co=GENIE.Platform%3DAndroid
- **抓取日期**：2026-11-25
- **等级**：B（产品官方帮助）
- **章节/位置**：正文「Type with your voice」

**逐字原文：**

> "Tap an area where you can enter text. At the top of your keyboard, tap Microphone. When you see "Speak now," say what you want written."

> "To pause voice recording, tap Microphone."

**直译：**

> 「点按一个可以输入文字的区域。在键盘顶部，点按『麦克风』。当你看到『现在说话』时，说出你想写下的内容。」

> 「要暂停语音录制，点按『麦克风』。」

**解读：**

Gboard 与 iOS 听写同构：点按麦克风开始，再点暂停；识别结果写入输入框，不自动发送。它说明在主流移动输入栈里，「麦克风」默认是**输入方式**，不是「发送语音消息」的按钮。

这也解释了一个常见的用户预期：看到麦克风，用户可能以为「点一下就能说话」，而不是「按住才能录音」。如果 Dream 采用按住，必须在按钮旁把这个差异说清楚。

#### S11｜Gestures（Apple Human Interface Guidelines）

- **URL**：https://developer.apple.com/design/human-interface-guidelines/gestures
- **抓取日期**：2026-11-25
- **等级**：A（平台官方设计规范）
- **章节/位置**：「Best practices」「Custom gestures」「Standard gestures」

**逐字原文：**

> "Give people more than one way to interact with your app. People commonly prefer or need to use other inputs — such as their voice, keyboard, or Switch Control — to interact with their devices. Don’t assume that people can use a specific gesture to perform a given task."

> "Custom gestures ... make sure it’s: Discoverable / Straightforward to perform / Distinct from other gestures / Not the only way to perform an important action in your app or game"

> "Use shortcut gestures to supplement standard gestures, not replace them."

> "Avoid conflicting with gestures that access system UI."

> "Make custom gestures easy to learn. Offer moments in your app to help people quickly learn and perform custom gestures..."

> "Touch (or pinch) and hold ... Reveal additional controls or functionality."

**直译：**

> 「给人们不止一种与你的 App 交互的方式。人们通常更喜欢或需要使用其他输入方式——例如语音、键盘或 Switch Control——来与设备交互。不要假设人们一定能使用某个特定手势来完成某项任务。」

> 「自定手势……请确保它：可发现 / 容易执行 / 与其他手势区分开 / 不是执行 App 或游戏中重要动作的唯一方式。」

> 「使用快捷手势来补充标准手势，而不是替代它们。」

> 「避免与访问系统 UI 的手势冲突。」

> 「让自定手势容易学习。在 App 中提供时机，帮助人们快速学习并执行自定手势……」

> 「触摸（或捏合）并按住……显示附加控件或功能。」

**解读：**

HIG 没有直接说「长按录音不好」，但它给了三条硬约束：

1. 重要动作不能只有手势一条路；
2. 快捷手势只能补充标准手势，不能替代；
3. 手势必须可发现、可学习，且不能和系统手势冲突。

Dream 的「长按输入行录音」同时踩中三条：它是重要动作的唯一入口、是替代而非补充、且在输入框聚焦时与系统文本选择冲突。常驻麦克风不是「多此一举」，而是 HIG 要求的等价路径。

#### S12｜Understanding Success Criterion 2.5.1: Pointer Gestures（W3C WCAG 2.2）

- **URL**：https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html
- **抓取日期**：2026-11-25
- **等级**：A（标准）
- **章节/位置**：「The Intent」「Success Criterion」

**逐字原文：**

> "All functionality that uses multipoint or path-based gestures for operation can be operated with a single pointer without a path-based gesture, unless a multipoint or path-based gesture is essential."

> "A path-based gesture involves an interaction where the movement of the pointer along a specific path matters. Examples of a path-based gesture include swiping/"flicking"..."

> "Multipoint or path-based gestures can be used so long as the functionality can also be operated by another method, such as a tap, click, double tap, double click, long press, or click & hold."

**直译：**

> 「所有使用多点或基于路径手势进行操作的功能，都可以用单指针、无需基于路径手势的方式操作，除非多点或基于路径手势是必需的。」

> 「基于路径的手势是指指针沿特定路径移动才有意义的交互。基于路径手势的例子包括滑动/轻扫……」

> 「只要该功能还可以通过其他方式操作，例如点按、单击、双击、长按或按住并单击，就可以使用多点或基于路径手势。」

**解读：**

Dream 的「上滑 56pt 取消」是典型的 path-based gesture：结果取决于手指移动的方向和距离。按 WCAG 2.5.1，它必须有一个**单指针、非路径**的等价操作，例如一个可见的取消按钮。工作区草案的点按聆听态已经有 X/停止按钮，这是对的；但长按态还只有上滑，应该补上同样的按钮，不能让上滑成为唯一取消方式。

同理，如果语音入口只靠长按，也需要一个点按路径——这正是常驻麦克风的作用。

#### S13｜Understanding Success Criterion 2.5.2: Pointer Cancellation（W3C WCAG 2.2）

- **URL**：https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html
- **抓取日期**：2026-11-25
- **等级**：A（标准）
- **章节/位置**：「The Intent」「Success Criterion」与细则

**逐字原文：**

> "For functionality that can be operated using a single pointer, at least one of the following is true: No Down-Event; Abort or Undo; Up Reversal; Essential."

> "Abort or Undo: Completion of the function is on the up-event, and a mechanism is available to abort the function before completion or to undo the function after completion."

> "Up Reversal: The up-event reverses any outcome of the preceding down-event."

**直译：**

> 「对于可以用单指针操作的功能，以下至少一项必须为真：无按下事件；中止或撤销；抬起反转；必需。」

> 「中止或撤销：功能的完成发生在抬起事件上，并且有一种机制可以在完成前中止功能，或在完成后撤销功能。」

> 「抬起反转：抬起事件会反转前面按下事件的任何结果。」

**解读：**

Dream 的录音在按下后 420ms 启动，完成在抬起事件上；这本身不是最危险的 down-event 触发。但「松手后立即产生转写结果」仍需要 abort/undo：录音中可以用上滑/取消按钮中止；转写填入输入框后，应该有一个显式的「撤销」或「重新转写」。

这条标准和 S15 的「确认或撤销」相互印证：不是要求每一步都弹窗，而是要求用户有退路。

### 2.3 可发现性与误触（Q3）

#### S14｜3D Touch on iPhone 6S: Embrace the Force（NN/g）

- **URL**：https://www.nngroup.com/articles/3d-touch/
- **抓取日期**：2026-11-25
- **等级**：A（一级研究机构）
- **作者/日期**：Raluca Budiu，2015-11-01
- **章节/位置**：正文第 2–3 段与「Long press vs. 3D Touch」

**逐字原文：**

> "First and foremost, gestures have no natural signifiers: most of the time, people have no idea what gestures they are supposed to use with an interface. Designers have to work hard to create signifiers for the gestures that they employ. Second, gestures are not easily memorable. Especially when there are many gestures to be learned, people often get confused and forget which gesture they are supposed to use for which action. And last but not least, gestures can sometimes be hard to produce reliably."

> "Even after using my new iPhone for a month, half the time my 3D Touch gestures end up being interpreted as long presses."

> "Whenever the long press is available, the action triggered by it is inadvertently taken instead of that corresponding to the 3D Touch."

**直译：**

> 「首先，手势没有天然的可供性（signifier）：大多数时候，人们根本不知道应该在界面上使用什么手势。设计师必须努力为他们采用的手势创造可供性。其次，手势不容易被记住。尤其是需要学习很多手势时，人们常常会混淆，忘记哪个手势对应哪个动作。最后但同样重要的是，手势有时很难可靠地执行。」

> 「即使在使用我的新 iPhone 一个月后，仍有一半时间，我的 3D Touch 手势最终被识别为长按。」

> 「只要长按可用，长按触发的动作就会在无意中被执行，而不是 3D Touch 对应的动作。」

**解读：**

这是「长按发现率低」最直接的 A 级证据之一：手势没有天然 signifier，不容易记，也不容易稳定执行；NN/g 的作者自己用了一个月，仍有一半时间把 3D Touch 误成长按。3D Touch 这项技术后来退场了，但「长按与相邻手势竞争会导致误触发」的机制仍然成立。

Dream 的具体冲突不是 3D Touch，而是「输入框长按 = 录音」与「输入框长按 = 选字」。机制相同：同一个长按被两个动作争夺，且用户无法从界面看出哪个会赢。不要把它说成「NN/g 研究了输入框选字」——它没有；它研究的是长按与相邻力度手势的混淆。结论只取「同类手势竞争会导致误触发」这一层。

#### S15｜Using Swipe to Trigger Contextual Actions（NN/g）

- **URL**：https://www.nngroup.com/articles/contextual-swipe/
- **抓取日期**：2026-11-25
- **等级**：A（一级研究机构）
- **作者/日期**：Angie Li，2017-02-12
- **章节/位置**：「Problems with contextual swipe」与「Preventing errors」

**逐字原文：**

> "Lack of signifiers makes it unclear where the contextual swipe can be used. (This is a general problem for gesture-based interactions.)"

> "Remember, most users won’t discover these actions (or they will discover them only accidentally when they attempt to delete the item)."

> "To prevent such accidents, it’s important to always ask for confirmation or provide an easy way to undo the swipe."

**直译：**

> 「缺乏可供性使人们不清楚在哪里可以使用上下文滑动。（这是基于手势的交互的普遍问题。）」

> 「记住，大多数用户不会发现这些动作（或者他们只会在尝试删除条目时偶然发现）。」

> 「为防止此类事故，重要的是始终请求确认，或提供一种简单的方式来撤销滑动。」

**解读：**

隐藏手势的典型失败模式是「没人发现」和「发现时已经误触」。NN/g 的处方很具体：确认，或可撤销。

对 Dream 来说，这两点分别对应：

- 入口：不要让「长按输入行」成为唯一发现路径；常驻麦克风 + 一次性提示。
- 取消/转写：不要让「上滑 56pt」成为唯一退路；可见的取消按钮 + 转写后的撤销。

#### S16｜Touch Target Size: A Key Mobile Design Element（NN/g）

- **URL**：https://www.nngroup.com/articles/touch-target-size/
- **抓取日期**：2026-11-25
- **等级**：A（一级研究机构）
- **日期**：2019-05-05
- **章节/位置**：正文第 1–3 段

**逐字原文：**

> "A past study from the MIT Touch Lab found that the average person’s fingertips are 1.6–2cm (0.6–0.8 in) wide. The impact area of the typical thumb is even larger — an average of 2.5cm (1 inch) wide!"

> "To avoid accidental taps, targets must first be big enough, and then also spaced well enough."

> "Not only do small targets take longer to reach, but they also increase the chance of a slip: accidentally tapping a wrong target that is placed too close to the desired one."

**直译：**

> 「麻省理工学院触摸实验室过去的一项研究发现，普通人指尖的宽度为 1.6–2 厘米（0.6–0.8 英寸）。典型拇指的影响区域甚至更大——平均宽度为 2.5 厘米（1 英寸）！」

> 「为避免误触，目标首先必须足够大，然后还要有足够的间距。」

> 「小目标不仅需要更长时间才能触及，而且还会增加滑错的风险：意外点按了离目标太近的错误目标。」

**解读：**

「常驻麦克风会不会误触」的答案不是简单的「会/不会」，而是取决于两个可控变量：**尺寸**和**间距**。拇指影响区平均 2.5cm，如果麦克风和发送键各 44dp、紧挨着放，误触概率会上升；如果各 48dp、中间留出间距，风险会下降。

这条证据也说明：把麦克风放在底部不是问题，底部恰恰是拇指容易到达的地方；问题是你是否给了它足够的空间，以及误触后有没有退路。

#### S17｜How Do Users Really Hold Mobile Devices?（UXmatters / Josh Hoober）

- **URL**：https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- **抓取日期**：2026-11-25
- **等级**：B（大规模现场观察，非同行评审；2013 年设备尺寸，只取方向性结论）
- **作者/日期**：Josh Hoober，2013-02-18
- **章节/位置**：「How do people hold their phones?」与「Thumb reach」

**逐字原文：**

> "one handed —49% cradled —36% two handed —15%"

> "Cradling is my term for using two hands to hold a mobile phone, but using only one hand to touch the screen or buttons."

> "Green indicates the area a user can reach easily; yellow, an area that requires a stretch; and red, an area that requires users to shift the way in which they’re holding a device."

> "Some designers may interpret charts of one-handed use to mean that they should place low-priority or dangerous functions in the hard to reach area in the upper-left corner of the screen. But I wouldn’t recommend that."

**直译：**

> 「单手——49%；托持——36%；双手——15%。」

> 「『托持』（cradling）是我的说法，指用双手拿着手机，但只用一只手触摸屏幕或按钮。」

> 「绿色表示用户可以轻松触及的区域；黄色表示需要伸展的区域；红色表示用户需要改变握持方式的区域。」

> 「有些设计师可能会把单手握持的图表理解为：应该把低优先级或危险功能放在屏幕左上角难以触及的区域。但我不建议这样做。」

**解读：**

约一半用户单手握持，底部是容易触及的区域。所以「把麦克风放在底部」在可达性上是合理的；但可达性高也意味着容易碰到。Hoober 还专门反对「把危险功能放到难达区」这种反向利用——这说明不能靠「把它挪到角落」来防误触，只能靠尺寸、间距、确认和撤销。

这条来源是 2013 年的，设备尺寸和握持方式已经变化；只取「底部易达、握持会变化、不要用位置惩罚用户」三个方向性结论，不引用具体像素。

#### S18｜State layers（Material 3）

- **URL**：https://m3.material.io/foundations/interaction/states/state-layers
- **抓取日期**：2026-11-25
- **等级**：B（组件库规范）
- **章节/位置**：「States」→「State layer」

**逐字原文：**

> "The size of state layers is 40dp while the interactive target size is 48dp."

**直译：**

> 「状态层的尺寸是 40dp，而交互目标尺寸是 48dp。」

**解读：**

Material 3 把 48dp 作为交互目标尺寸。工作区草案的麦克风点击目标是 44×44dp（`composer.dart` 的 `_MicButton` 约束），低于这个值；如果最终采用常驻麦克风，建议至少 48×48dp，并把视觉图标控制在 24dp 左右，避免视觉上过大。

这是 Q3 里最具体、最可执行的一条：不是「感觉小」，而是有组件库数值。

#### S19｜iOS 27 finally lets you hide the Audio button in Messages—here's how（Macworld）

- **URL**：https://www.macworld.com/article/3202129/ios-27-finally-lets-you-hide-the-audio-button-in-messages-heres-how.html
- **抓取日期**：2026-11-25
- **等级**：C（二手科技媒体；**不可单独支撑结论**）
- **日期**：2026-07-30
- **章节/位置**：正文第 1–2 段

**逐字原文：**

> "Tired of accidentally hitting that button in Messages? iOS 27 lets you change it or turn it off."

> "That annoying microphone button on the text entry line in the Messages app that kicks off dictation. It could be a button to start recording an Audio Message, depending on context."

> "Either way, it’s not something you want to tap when you’re trying to type text. And for far too many people, that’s exactly what happens."

**直译：**

> 「厌倦了在 Messages 里误按那个按钮？iOS 27 允许你更改它或关掉它。」

> 「Messages App 文本输入行上那个烦人的麦克风按钮，会启动听写。根据上下文，它也可能是开始录制音频消息的按钮。」

> 「无论如何，它都不是你在打字时想点按的东西。而对太多人来说，这恰恰就是会发生的事。」

**解读：**

这条只能作为现象旁证：真实产品里，输入行常驻麦克风确实会造成误触，Apple 的补救是允许用户隐藏/更改它。它不能单独证明「Dream 也会误触」，也不能证明「应该常驻或不应该常驻」；它只提醒你：常驻入口的代价是真实的，必须用尺寸、间距、确认/撤销来对冲。

C 级来源在本文中只出现在这里，且不进入任何单独结论。

### 2.4 转写结果的处理（Q4）

#### S20｜How to preview a voice message（WhatsApp FAQ）

- **URL**：https://faq.whatsapp.com/1044960269529733/
- **抓取日期**：2026-11-25
- **等级**：B（产品官方帮助）
- **章节/位置**：正文

**逐字原文：**

> "You can listen to your voice message before you send it. ... Click [play] to listen to your recording. You can also click any part of the recording to play it from that timestamp. Click [trash] to delete, click [resume] to continue recording, or click [send] to send the voice message."

**直译：**

> 「你可以在发送语音消息之前先听一遍。……点按[播放]收听你的录音。你也可以点按录音的任意位置，从那个时间点开始播放。点按[垃圾桶]删除，点按[继续]继续录音，或点按[发送]发送语音消息。」

**解读：**

WhatsApp 明确把「发送前试听」做成一条路径：播放、任意位置跳转、删除、续录、发送。它不是转写确认，但它是同一类需求——**在不可逆的发送之前，给用户一次检查的机会**。

如果 Dream 未来支持「发语音消息」而不只是转写，这个「试听/删除/续录/发送」的面板是 B 级参考；当前只做转写的话，对应的就是「转写后确认/撤销」，而不是音频试听。

#### S21｜How to turn voice message transcripts on or off（WhatsApp FAQ）

- **URL**：https://faq.whatsapp.com/241617298315321/
- **抓取日期**：2026-11-25
- **等级**：B（产品官方帮助）
- **章节/位置**：正文（页面正文未完整渲染）

**逐字原文：**

> "Voice messages transcripts on WhatsApp is only available on certain devices and may not be available to you yet."

**直译：**

> 「WhatsApp 上的语音消息转写仅在某些设备上可用，可能尚未向你提供。」

**解读：**

这条只能证明「WhatsApp 有转写功能，且是灰度」；页面没有渲染出具体操作步骤，无法证明它是发送前确认还是发送后的辅助显示。结合 S3（Telegram 把消息转成文字）和 S5（iOS Messages 自动转写音频消息），更合理的归类是「消息级辅助显示」，而不是「录音后的确认层」；但具体时机，官方页没有写，不能替它补。

它不能用来支持「转写后应先确认再发送」；那条结论由 S2、S9、S10、S5 支撑。

## 三、横向对比表

> 读表说明：`—` 表示官方页没有写，不是「不存在」；`待验证` 表示本次没有取得逐字来源，不写成结论。Dream 行分「HEAD 基线」「工作区草案」「建议」三种，避免把草案当现状。

### 3.1 入口形态

| 产品/方案 | 空输入时 | 有文字时 | 官方是否明确写「同一位置替换」 | 证据 |
|---|---|---|---|---|
| 微信 | 左下角语音按钮；点按后底栏变「Hold to Talk」 | 官方页未说会隐藏；语音按钮是模式切换，不占发送位 | 否；微信是**不互换**的反例 | S1 |
| Telegram | 麦克风图标（官方未写位置）；按住录音，点一下切相机 | 官方页未写 | 否（官方只描述麦克风图标） | S3 |
| WhatsApp | 麦克风图标（官方未写位置）；点按开始录音 | 官方页未写 | 否（官方只描述点按 + 对勾） | S4 |
| iOS Messages | 输入框内麦克风（长按快捷）+「+ → Audio」主路径 | 发送图标 | 否（官方只写长按快捷，不写替换） | S5 |
| Dream HEAD | 无麦克风 | 无麦克风 | — | `composer.dart` HEAD |
| Dream 工作区草案 | 麦克风 | 发送；**麦克风消失** | 代码事实；不是官方规则 | `composer.dart:347-348` |
| Dream 建议 | 麦克风常驻 | 麦克风 + 发送并存 | 设计建议，不是官方规则 | S6、S11 |

**结论：**

1. 本次抓到的微信（两页）、Telegram、WhatsApp、iOS Messages 官方页里，没有任何一页逐字写出「输入为空显示麦克风、有文字显示发送」。这是一项**界面惯例**，不是可引用的平台规范；如果团队要做，只能标为 B 级产品惯例或待实测。
2. 微信是明确反例：官方页只证明「左下角有语音按钮」，它作为模式切换键，不占发送位；「+ 一直显示」是界面观察，官方页没有逐字说明，不能和语音按钮混成一条规则。
3. Signal 本次没有取得语音消息官方页（见 5.2），因此不列入对比表；这不是说 Signal 没有语音，而是没有可引用的官方文字，不能靠猜。
4. 「互换」节省一个按钮，但有文字时语音入口消失；如果产品目标是「常驻」，互换在定义上就不满足。

### 3.2 录音手势、取消与上限

| 产品/方案 | 开始录音 | 结束/发送 | 取消 | 时长上限/自动停 | 证据 |
|---|---|---|---|---|---|
| 微信 | 按住「Hold to Talk」 | 松手即发送语音 | 滑向左上角 | 单条 60 秒 | S1 |
| 微信（转文字分支） | 按住并滑向右上 | 松手开始转写；绿色框内编辑后点 Send | 不滑向右上；改滑左上取消 | 60 秒 | S2、S7 |
| Telegram | 按住麦克风 | 官方未写松手动作；上滑可锁定后继续录 | 上滑 = 锁定，**不是取消** | — | S3 |
| WhatsApp（Web 文案） | 点按麦克风 | 点对勾发送 | 点 X | — | S4 |
| iOS Messages | 长按输入框麦克风；或「+ → Audio」 | 停止后点发送 | 点垃圾桶 | — | S5 |
| iOS 听写 | 点按麦克风 | 再点麦克风/说「停止听写」 | 再点麦克风 | 静音 30 秒自动停 | S9 |
| Gboard | 点按麦克风 | 再点暂停 | 再点 | — | S10 |
| Walkie-Talkie | 按住 Talk | 松手即被对方听到 | — | — | S8 |
| Dream HEAD | 长按输入行 420ms | 松手转写 | 上滑 56pt | — | `composer.dart:63,120-121` |
| Dream 工作区草案 | 点按麦克风；未聚焦时长按输入行 420ms | 再点停止；或松手转写 | 点按聆听态有 X/停止；长按态仅上滑 56pt | — | `composer.dart:181,189-190` |
| Dream 建议 | 点按麦克风为主；长按仅在未聚焦时做加速器 | 再点停止；转写后填入输入框 | 可见 X + 上滑快捷 | 建议 60 秒上限 + 计时 | S1、S8、S9、S12 |

**结论：**

1. 「松手即发送」不是跨产品标准：微信和 Walkie-Talkie 明确这样，Telegram/WhatsApp/iOS Messages 都不是（或官方未写）。Dream 不应把它当成「行业默认」。
2. 「上滑取消」也不是通用语义：微信上滑（左上）是取消，Telegram 上滑是锁定。同一个手势在不同产品里可以相反，必须给文案/动效，不能只靠肌肉记忆。
3. 「60 秒上限」目前只有微信官方页明确写；iOS 听写是 30 秒静音自动停，不是时长上限。Dream 若设上限，应写清楚数字和到达上限后的行为（自动停止并转写？还是丢弃？），不要只留一个计时器。

### 3.3 转写结果的处理

| 产品/方案 | 转写时机 | 结果去哪 | 是否需要用户确认后发送 | 证据 |
|---|---|---|---|---|
| 微信 | 录音中滑向右上 | 绿色可编辑框 | 是；编辑后点「Send」 | S2、S7 |
| iOS 听写 | 实时 | 当前光标处的输入框 | 是；用户自己按发送 | S9 |
| Gboard | 实时 | 输入框 | 是；用户自己按发送 | S10 |
| iOS Messages | 消息级（官方未写发送前/后） | 消息的转写文本 | 语音消息本身已发送；没有「发送前确认转写」 | S5 |
| WhatsApp | 消息级（灰度；页面未给步骤） | 消息的转写文本 | 语音消息本身已发送 | S21 |
| Telegram | 消息级（Premium 一键；官方未写时机） | 消息的转写文本 | 语音消息本身已发送 | S3 |
| Dream HEAD | 松手后 | 输入框（`_fillFromVoice`） | 是；用户自己按发送 | `chat_screen.dart:259-267` |
| Dream 工作区草案 | 停止后 | 输入框 | 是；用户自己按发送 | `chat_screen.dart` 同路径 |
| Dream 建议 | 停止后 | 输入框 + 显式撤销/重试 | 是；不自动发送 | S9、S10、S20、S13 |

**结论：**

1. 没有任何一个被引产品把「语音识别文本」在松手瞬间自动发给对方。微信要编辑后点 Send；iOS/Gboard 只填输入框；Messages/WhatsApp/Telegram 的转写是消息级辅助显示（具体时机官方未写，但都不是录音态的确认层）。
2. Dream 当前「转写填入输入框」的方向是对的；真正缺的是**显式的撤销/确认**，而不是「再实现一次填输入框」。
3. 如果产品想减少一次点击，可以学微信的「可选转文字分支」：默认松手发语音，想确认时走转文字；但 Dream 当前只做转写，没有「发语音」路径，所以更简单的做法是「转写后填入 + 撤销」，而不是复制微信的双分支。

## 四、对 Dream 的建议（含不采纳的选项及理由）

### 4.1 先给结论

1. **采用「常驻麦克风 + 独立发送键」，不要做「空输入麦克风 / 有文字发送」的唯一互换。** 互换省空间，但有文字时语音入口消失，和「常驻」目标矛盾；官方页也没有把它写成规则（S1、S5、S6）。
2. **点按为主，长按只做加速器。** 点按开始/停止符合 iOS 听写、Gboard 的模型；已聚焦时长按继续交给选字（S9、S11、S14）。
3. **录音中给可见取消 + 计时/上限；上滑 56pt 保留为快捷，但不能是唯一退路。** 微信的上滑取消是 B 级产品惯例，不是标准；WCAG 2.5.1 要求 path-based gesture 有单指针替代（S1、S12、S3）。
4. **转写填入输入框，加显式「撤销/重试」；不自动发送。** 微信要编辑后点 Send，iOS/Gboard 只填输入框，WhatsApp 发送前可试听；Dream 现有 `_fillFromVoice` 已经做对了一半（S2、S9、S20）。
5. **麦克风至少 48×48dp，和发送键留出间距；误触靠尺寸/间距/撤销，不靠把按钮挪到难达的角落。** Material 3 的交互目标是 48dp；NN/g 说目标要大、要隔开；Hoober 明确反对「把危险功能放到难达区」（S18、S16、S17）。

### 4.2 推荐形态

```
空输入：  [ + ] [ 输入框 .................... ] [ 🎤 48 ]
有文字：  [ + ] [ 输入框 ................ ] [ 🎤 48 ] [ 发送 48 ]
```

- 麦克风固定在输入框右侧，**发送键出现/消失时麦克风不位移**；空间不足时宁可压缩输入框，也不要让麦克风跳到发送键的位置。
- 麦克风 48×48dp，视觉图标约 24dp；与发送键之间留至少 8dp 间距（工程建议，不是平台规范）。
- 空输入时发送键可以禁用或视觉隐藏，但**保留槽位/间距**；不要让麦克风占据发送键的槽位，也不要让麦克风因为发送键出现而位移。
- 如果产品坚持「空输入只显示麦克风」以省空间，那么至少保留「有文字时麦克风仍在」；否则它不是常驻入口。

这个形态的证据链是：M3 认可输入框麦克风作为语音输入可供性（S6）；HIG 要求重要动作不止一条路（S11）；微信的反例说明「语音入口可以不占发送位」（S1）；NN/g 的尺寸/间距研究说明并排按钮需要空间（S16）。

### 4.3 录音态

```
[ X 取消 ] [ 00:00 / 01:00 ] [ 上滑取消 ] [ ■ 停止 ]
```

- 点按麦克风进入录音；再点停止；停止后转写。
- 录音态必须有可见的 X 和停止按钮；上滑 56pt 只是快捷方式，不能替代按钮。
- 显示计时和上限（建议 60 秒，参考微信 S1）；到达上限时自动停止并转写，不要静默丢弃。
- 上滑时给文字/动效反馈（「松开取消」），不要只靠震动；微信/Telegram 的同一手势语义相反，说明必须教（S1、S3、S7）。
- 如果保留「未聚焦时长按输入行 420ms」，把它当加速器：一旦输入框已聚焦，长按直接交给选字，不再启动录音（工作区草案 `composer.dart:181` 已经这样做）。

### 4.4 转写态

- 停止 → 显示「正在转写…」→ 成功后填入输入框，光标放末尾，键盘不自动弹（除非用户点输入框）。
- 在输入框上方显示一条短暂提示：「已转写 · 撤销」，保留 5 秒；点「撤销」恢复转写前的文本。这是对 S13「Abort or Undo」和 S15「confirmation or undo」的落地。
- 转写失败/为空：显示「没听清，重试」；不要静默失败，也不要把空文本填进输入框。
- 不自动发送。发送是用户的显式动作；如果未来加「发送语音消息」，再单独设计「试听/删除/续录/发送」面板（S20），不要和转写确认混在一起。

### 4.5 可发现性

- 首次使用在麦克风上方显示一次性提示「点按说话」，用户完成一次录音后消失；不要每次启动都弹（HIG「Offer moments」S11；NN/g 的「signifier」S14）。
- 设置里保留「语音输入」开关和「长按输入行录音」开关；让用户能关掉常驻入口（Macworld 的 C 级现象说明常驻入口可能被部分用户视为干扰，S19；但这条只作旁证）。
- 麦克风的 Semantics label 用「语音输入」，录音中用「正在录音，点按停止」，转写中用「正在转写」；这是工程无障碍建议，未在本次取证范围内单独验证。

### 4.6 不采纳的选项及理由

| 不采纳的选项 | 理由 | 证据 |
|---|---|---|
| 只保留「长按输入行 420ms」作为唯一入口 | 重要动作只有手势一条路；已聚焦时与选字冲突；可发现性差；无单指针替代 | S11、S14、S12 |
| 「空输入麦克风 / 有文字发送」作为唯一入口 | 有文字时语音入口消失，不满足「常驻」；官方页没有把它写成规则；微信是反例 | S1、S3、S4、S5、S6 |
| 微信式「整栏切换成 Hold to Talk」 | 可行，但多一次模式切换，且会替换键盘/输入区；Dream 的输入区更轻，没必要复制整栏模式 | S1（只证明微信这样做，不证明 Dream 需要） |
| 松手即发送（无确认） | 微信/Walkie-Talkie 这样做，但两者场景是「语音消息/对讲」；Dream 是转写，识别错误需要退路；WCAG 要求 abort/undo | S1、S8、S13、S15 |
| 转写后自动发送 | 没有主流产品这样做；识别错误会直接发给对方；与「用户确认」预期冲突 | S2、S9、S10、S5 |
| 只靠上滑 56pt 取消 | path-based gesture；Telegram 的上滑还是相反语义；无可见退路 | S12、S3、S7 |
| 把麦克风放到屏幕左上角等难达区防误触 | Hoober 明确反对用位置惩罚用户；误触应靠尺寸/间距/撤销 | S17、S16 |
| 浮动麦克风气泡/悬浮球 | 本次没有取得任何平台规范或产品官方证据；会遮挡内容，且与输入区空间关系不稳定 | 无（不采纳，证据不足） |

### 4.7 验收标准

1. 空输入和有文字时，麦克风都可见；发送键出现/消失时麦克风不位移。
2. 输入框已聚焦时，长按不再启动录音；长按只做选字。
3. 录音态有可见的 X、计时、停止；上滑 56pt 仍可用，但不是唯一取消方式。
4. 录音到达上限时自动停止并转写，有明确提示；不静默丢弃。
5. 转写成功后填入输入框，不自动发送；5 秒内可撤销；失败可重试。
6. 麦克风点击目标 ≥48×48dp，与发送键有可感知的间距；首次使用有一次性提示。

## 五、抓取记录

> 方法：优先用浏览器/`curl` 直连；直连失败时走本机 HTTP 代理 `127.0.0.1:7892`；对客户端渲染的页面用 `https://r.jina.ai/<URL>` 经同一代理取正文。Apple 支持页用 `en-gb` 英文版，避免被地理重定向到 `zh-cn`。Signal 用 Zendesk 公共 API。没有使用 archive.org 的缓存，也没有做真机截图。

### 5.1 成功抓取

| # | URL | HTTP | 结果/改道 |
|---|---|---|---|
| S1 | https://cs.help.wechat.com/hc/en-us/articles/11915240382863-How-to-Send-a-Voice-Message | 200 | 直连 `curl` 超时；改用 Jina reader + 代理，正文完整 |
| S2 | https://newsroom.wechat.com/newsRooms/NewsDetails/TheSmarterWaytoTalkNowYouCanEditVoice-to-TextBeforeSending | 200 | 正文完整；页面元数据日期 2025-07-25 |
| S3 | https://telegram.org/faq | 200 | 直连/CDP 20–30 秒超时，`web_fetch` 报 non-public IP；改走代理，正文完整 |
| S4 | https://faq.whatsapp.com/657157755756612/ | 200 | 默认 UA 返回 400；Safari UA 200 但正文客户端渲染；改用 Jina reader + 代理 |
| S5 | https://support.apple.com/en-gb/guide/iphone/iph2e42d3117/ios | 200 | `en-us` 被重定向到 `en-cn`；改用 `en-gb` 英文页 |
| S6 | https://m3.material.io/components/text-fields/guidelines | 200 | 直连 HTML 200 但是 JS 壳；改用 Jina reader + 代理取正文 |
| S7 | https://cs.help.wechat.com/hc/en-us/articles/11917834863247-How-do-I-convert-a-voice-message-to-text-during-recording | 200 | 直连超时；改用 Jina reader + 代理 |
| S8 | https://support.apple.com/en-gb/guide/watch/apd246d6eefd/11.0/watchos/11.0 | 200 | 108416 页只有 hold 描述，没有 tap 替代；改到 watchOS 11 guide 取「tap to talk」 |
| S9 | https://support.apple.com/en-gb/guide/iphone/iph2c0651d2/ios | 200 | `en-us` 重定向；改用 `en-gb` |
| S10 | https://support.google.com/gboard/answer/2781851?hl=en&co=GENIE.Platform%3DAndroid | 200 | 经代理抓取，正文完整 |
| S11 | https://developer.apple.com/design/human-interface-guidelines/gestures | 200 | 直连 HTML 200 但是 JS 壳；改用 Jina reader + 代理 |
| S12 | https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html | 200 | 直连，正文完整 |
| S13 | https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html | 200 | 直连，正文完整 |
| S14 | https://www.nngroup.com/articles/3d-touch/ | 200 | 直连，正文完整；元数据日期 2015-11-01 |
| S15 | https://www.nngroup.com/articles/contextual-swipe/ | 200 | 直连，正文完整；元数据日期 2017-02-12 |
| S16 | https://www.nngroup.com/articles/touch-target-size/ | 200 | 直连，正文完整；元数据日期 2019-05-05 |
| S17 | https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php | 200 | 直连，正文完整；2013 年数据，只取方向性结论 |
| S18 | https://m3.material.io/foundations/interaction/states/state-layers | 200 | 直连 HTML 200 但是 JS 壳；改用 Jina reader + 代理 |
| S19 | https://www.macworld.com/article/3202129/ios-27-finally-lets-you-hide-the-audio-button-in-messages-heres-how.html | 200 | 经 Jina reader + 代理；C 级，只作旁证 |
| S20 | https://faq.whatsapp.com/1044960269529733/ | 200 | 经 Jina reader + 代理，正文完整 |
| S21 | https://faq.whatsapp.com/241617298315321/ | 200 | 经 Jina reader + 代理；正文只渲染出可用性说明，操作步骤未出现 |

### 5.2 失败与未采用

| URL | HTTP/状态 | 失败原因 | 改道/处理 |
|---|---|---|---|
| https://support.signal.org/hc/en-us/articles/360007060212 | 403 | Cloudflare 拦截直连/代理 | 改用 Zendesk API `https://support.signal.org/api/v2/help_center/en-us/articles/360007060212.json`，200；文章只讲文字发送，无语音消息专页 |
| https://support.signal.org/api/v2/help_center/en-us/articles/search.json?query=voice | 200 | 搜索无语音录制专页 | 不臆测 Signal 的语音交互；报告中写「证据不足，不下结论」 |
| https://developer.android.com/guide/topics/ui/accessibility/apps | 超时 | 直连 `developer.android.com` 超时；`developer.android.google.cn` 会跳 `zh-cn`，猜测路径多 404 | 本次不引用 Android 官方手势指南；改用 Apple HIG / W3C / NN/g |
| https://www.nngroup.com/articles/mobile-gestures/ | 404 | 该路径不存在 | 未使用；改用 NN/g 的 3D Touch / contextual swipe / touch target 三篇 |
| https://www.nngroup.com/articles/long-press/ | 404 | 该路径不存在 | 未使用 |
| https://telegram.org/faq（直连） | 超时 | 直连 20–30 秒无响应 | 改走 `127.0.0.1:7892` 代理，200 |
| https://cs.help.wechat.com/...（直连） | 超时 | 直连无响应；`web_fetch` 也失败 | 改用 Jina reader + 代理，200 |
| https://faq.whatsapp.com/657157755756612/（默认 UA） | 400 | 默认 `curl` UA 被拒 | 改用 Safari UA 或 Jina reader + 代理，200 |
| https://r.jina.ai/<URL>（直连） | 超时 | 直连 `r.jina.ai` 不通 | 加 `-x http://127.0.0.1:7892`，200 |
| https://support.apple.com/en-us/guide/iphone/iph2c0651d2/ios | 302→zh-cn | 按 IP 地理重定向到中文页 | 改用 `en-gb`，200 |
| https://support.apple.com/en-gb/108416 | 200 | 页面只有 hold 描述，没有「tap to talk」 | 改到 watchOS 11 guide `apd246d6eefd`，200 |

### 5.3 未完成/未验证

- **没有做真机截图**：微信、Telegram、WhatsApp 的 iOS/Android 实际界面没有在本机复现；本文只依据官方文字，不把 Web 行为外推到移动端。
- **没有做可用性测试**：无法证明 Dream 用户对「常驻麦克风」或「按住/点按」的偏好；这需要后续 5–8 人的形成性测试。
- **没有量化长按发现率**：NN/g 的 3D Touch 研究是定性的，且不是输入框场景；本文只说「隐藏手势可发现性差」，不说具体百分比。
- **没有取到 WhatsApp 移动端 tab 的独立正文**：官方 iOS/Android 参数页复用 Web 文案；本文标注为「官方文案点按 + 对勾，移动端手势未逐字证实」。
- **没有取到 Signal 的语音消息专页**：Zendesk API 搜索无结果；本文不对 Signal 下结论。
