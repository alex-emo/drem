# 0005 · 语音需要一个看得见的入口

- 日期：2026-11-25
- 状态：交互模型仍有效（点击切换 + 长按加速器）；**布局与退路已被 0006 修订**（互换槽位 → 固定麦克风 + 48dp + 双态按钮 + 计时/撤销），2026-11-25
- 前置：0004 把长按手势收窄到输入框之后，「聚焦编辑时不能录音」成为明确缺口

> 后续：C 研究（`design-lab/research/C-voice-entry.md`）返回后，§4 的「空输入麦克风 / 有文字发送」互换被 0006 推翻；点按为主、长按仅加速、转写不自动发送三条保留。读本文时以 0006 为准。

## 1. 问题

现在语音只有一条路：**未聚焦**时按住输入行 420ms。它同时踩了三条约束：

1. 约束七「任何隐藏手势必须有可发现路径，或提供可见替代入口」——现在两者都没有；
2. 0004 之后，用户一旦在编辑文字（键盘已开），连这条隐藏路径也失效；
3. 录音开始后没有「取消」以外的第二个决定点：松手即转写、即填进输入框，用户来不及反悔（转写本身可再编辑，但等待网络期间没有反馈）。

## 2. 证据

### 2.1 Apple 官方 · 在 iPhone 上听写文本（A 级，抓取 2026-11-25，HTTP 200）

来源：<https://support.apple.com/guide/iphone/dictate-text-iph2c0651d2/ios>（中文页）

> 通过 iPhone 上的“听写”，你可以在可进行键入的任何位置听写文本。你还可以结合使用键入和听写：听写期间，键盘保持打开，方便你在轻触输入和语音输入文本间轻松切换。
> 轻点屏幕键盘上的〔麦克风〕……
> 若要停止听写，请执行以下一项操作：轻点〔麦克风〕。／请说“停止听写”。／保持静音 30 秒钟。“听写”会自动停止。

读出来的三件事：
- **点一下开始、再点一下停止**，不是按住；这是系统级文本框的通用模型，用户不需要学。
- **键盘保持打开**，可以在「打字」和「说话」之间无缝切换；语音不是另一个模式。
- 停止有多个出口（点麦克风、说停止、静音 30 秒）——出口比入口多，是安全网。

### 2.2 微信官方 · 发送语音消息（A 级，抓取 2026-11-25，HTTP 200）

来源：<https://cs.help.wechat.com/hc/en-us/articles/11915240382863-How-to-Send-a-Voice-Message>

> In the chat window, tap the voice button in the lower-left corner.
> This will switch the bottom bar to "Hold to Talk" mode.
> Press and hold the button to record your message, then release it to send.

> Note: The maximum length for a single voice message is 60 seconds.

> Tip: Canceling a Voice Message After Recording Has Started
> If you change your mind, simply slide your finger to the top-left from the button to cancel the recording.

读出来的三件事：
- 微信也是**先点一次语音键声明意图**，再按住录；点按不是死交互。
- 「松开发送」是因为产物是语音消息；Dream 的产物是文字，所以松手/停止应**填入输入框**。
- 左上滑取消值得保留：录音里「反悔」的手势是被教过的。

### 2.3 Apple HIG · Gestures / Context menus（A 级，平台官方；引自 `research/B-chat-patterns.md` §一）

> Touch (or pinch) and hold = Reveal additional controls.

HIG 允许长按唤起附加能力，但 Context menus 一节的配套要求是：主界面要有等价入口，长按只能是加速器。Dream 现在把长按当唯一入口，不合规。

### 2.4 转写结果的处理（现状，非外部证据）

`chat_screen.dart` 的 `_fillFromVoice()` 把转写结果拼进 `_controller` 并聚焦，**不自动发送**。保留：语音是输入方式，不是发送方式。

## 3. 候选与裁定

| 方案 | 内容 | 裁定 |
| --- | --- | --- |
| A 点击切换（听写模型） | 点麦克风开始、再点停止；键盘不收起 | **采纳**，与 2.1 一致 |
| B 按住麦克风 | 按住录、松手停 | 否决：看得见的按钮短按却无事发生，是死交互；微信的按住建立在 2.2 的「先点一次切模式」之上 |
| C 微信两步模式 | 点麦克风把底栏切成「按住说话」 | 否决：Dream 是文字聊天，语音是听写；多一个模式会打断「打字/说话混合」的连续输入（2.1 的反面） |
| D 只改文案 | 把 hint 改成「长按说话」 | 否决：文案不是控件，约束七要求可见替代入口 |

保留：**未聚焦时长按输入行**仍作为加速器（0004 的成果），与 A 并存。它给熟练用户「按住即说」的节奏，但不再是唯一路径。

## 4. 交互规格

- **入口**：输入为空且语音可用时，右侧主按钮从「发送」换成**麦克风**（44×44 圆形，品牌色实心底 + 白色图标；tooltip「语音输入」）。有文字时仍是发送按钮——一个位置只放一个主动作。
- **开始**：轻点麦克风 → 轻微触感反馈，立即进入「聆听」态；键盘保持打开，光标留在输入框。
- **聆听态**：输入行被覆盖条替换，显示红点 + 「正在聆听」+ 右侧两个 44×44 动作：**取消**（×，次要色）与**停止**（方形，品牌色实心）。停止 = 转写并填入；取消 = 丢弃录音。
- **结束**：停止 → 转写文本填入输入框、聚焦、光标到末尾、**不自动发送**；取消 → 丢弃，恢复输入行。
- **失败**：开始录音失败（无权限）→ 立刻退出聆听态，用现有 SnackBar 报错；转写失败同理，输入框内容不变。
- **冲突**：聆听时禁用发送与再次开始；`voiceEnabled == false`（流式或没有控制器）时不显示麦克风，只显示禁用发送。
- **长按加速器**：未聚焦时长按输入行 420ms → 进入按住录音（覆盖条文案「正在聆听 · 上滑取消」/「松开取消」），松手转写；与 0004 完全一致。

## 5. 验收

- [x] 输入为空、语音可用时右侧显示麦克风（tooltip「语音输入」）；输入文字后变回发送。
- [x] 点麦克风 → 覆盖条出现「正在聆听」与取消/停止；键盘不收起。
- [x] 点停止 → `onVoiceEnd(false)`，转写文本填入输入框，不自动发送。
- [x] 点取消 → `onVoiceEnd(true)`，输入框内容不变。
- [x] 开始录音失败 → 覆盖条消失并报错（不留在假聆听态）。
- [x] 未聚焦时长按输入行仍可录音（0004 的 4 条测试保持绿）。
- [x] 聆听时发送按钮不可用；流式中不显示麦克风。
- [x] `flutter test` 112 passed / `flutter analyze` 仅既有 3 条 info；深/浅色截图见 `design-lab/shots/composer-voice-*`。

## 6. 回滚

新增按钮、聆听态与覆盖条都在 `composer.dart` 内部；`ChatScreen` 只把 `onVoiceStart` 从 `VoidCallback` 改为 `Future<bool>`（返回是否真的开始），其余接口不变。删除麦克风与聆听态即可回到 0004 行为。

## 7. 实现记录（2026-11-25）

- `composer.dart`：`onVoiceStart` 由 `VoidCallback?` 改为 `Future<bool> Function()?`（返回是否真的开始）；新增 `_listening/_starting/_empty`；`_empty` 由 controller 监听维护，决定右侧是麦克风还是发送。
- 覆盖条改为 `_VoiceBar(handsFree:)`：按住模式无按钮、沿用「正在聆听 · 上滑取消」；点击模式带「取消录音」「停止录音」两个 44×44。
- 覆盖条出现时整行 `Opacity` 归零（原实现只看 `_holding`，点击模式会透出底层文字——截图时发现并修掉）。
- 按住录音与权限对话框竞争时用 `_holdStarted/_releasePending` 记下松手，开始成功后立即结算，避免「松手了还在录」。
- `chat_screen.dart`：`_startVoiceHold` 改为 `Future<bool>`，失败时 `return false` 并保留 SnackBar。
- 测试：`test/composer_voice_test.dart` 6 条；`test/composer_gesture_test.dart` 4 条类型适配后仍绿；全量 112 passed。
- 截图：`design-lab/shots/composer-voice-idle-2026-11-25.jpg`、`...-listening-dark-...`、`...-listening-light-...`；harness 存于 `design-lab/tools/composer_screenshot_test.dart`。

## 8. 未决

- 转写中的等待（网络 30s 上限）目前无进度提示；是否加「转写中…」占位，等真实使用后再定。
- `research/C-voice-entry.md`（Telegram/Signal/iMessage）仍未回；若出现相反证据，先改本文件再改代码。
