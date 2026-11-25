# 0004 · 输入区的长按手势只属于输入框，不属于整行

- 日期：2026-11-25
- 状态：已实施（回归测试已锁定）
- 触发：0003 截图核对时的怀疑，用临时探针测试证实

> 程序说明：这条改动先写了代码（约 10 行）再补本文档，违反了约束四「先写决策，再写代码」。记录在此，不追认程序为正确；后续改动（0005）按程序先落盘。

## 1. 问题证据

`lib/features/chat/widgets/composer.dart` 用一个 `Listener` 包住整行 `Row`（附件 + 输入框 + 发送），`onPointerDown` 无条件起 420ms 计时器。同时 `TextField.enableInteractiveSelection` 只在聚焦时为 true，意味着「聚焦后长按 = 选字」是设计意图。

用临时测试 `test/_probe_test.dart` 在两条路径上打点：

```text
started while focused = 1
started while holding send = 1
```

两个都是真问题：

1. **聚焦后长按选字 → 420ms 后开始录音。** 用户想选一段文字复制，结果手机振一下、麦克风打开、界面进入「正在聆听」。这是破坏性冲突：两个手势抢同一块玻璃。
2. **按住发送按钮稍久 → 开始录音。** 发送键本来就在拇指下，长按 420ms 是常见误触；用户以为在发送，其实在录音，松手后还会多一次转写网络请求。

## 2. 候选方案

### A. 只加焦点守卫，Listener 仍包整行

`if (focusNode.hasFocus) return;`

解决了 1，没解决 2（未聚焦时按住发送仍会录音；而此时键盘可能没开，用户更容易按到发送键）。**不完整。**

### B. 只把手势挪到输入框，不加焦点守卫

解决了 2（附件/发送不再命中），没解决 1。**不完整。**

### C. 手势挪到输入框 + 聚焦守卫（采纳）

两处都改。长按的语义变成「在输入框上、且当前不在编辑文字」。已聚焦时的长按完全交还给 TextField 的选择手势；附件/发送是明确动作，不参与长按。

代价：**聚焦编辑时就无法用长按录音**，必须先收起键盘。这个缺口由 0005（可见语音入口）解决——见 §6。

### D. 让输入框自己处理长按（GestureDetector + onLongPressStart）

Flutter 的 `TextField` 已经注册了长按选择的手势，套一层 `GestureDetector` 会和它在手势竞技场里竞争，行为依 hit-test 顺序而不稳定；而且长按开始/结束只能拿到一个回调，拿不到「上滑取消」的连续位移。**否决：把简单问题变复杂。**

## 3. 决定

- `_onPointerDown` 首行：`if (widget.focusNode.hasFocus) return;`，附注释指向 0005 的语音键。
- `Listener` 从 `Row` 下移到 `Expanded` 内的 `Padding` 外层，附件与发送不再是长按目标。
- 其余手势参数不动：420ms、12pt 防抖、56pt 上滑取消、`HapticFeedback.mediumImpact`。
- 行为契约写回 `docs/design/components/composer.md` §2/§3/§4/§6。

## 4. 验收

- [x] 已聚焦时长按 600ms：`onVoiceStart` 不触发，`enableInteractiveSelection == true`（`test/composer_gesture_test.dart`）。
- [x] 按住发送按钮 600ms：`onVoiceStart` 不触发（同上）。
- [x] 未聚焦时长按仍开始语音；上滑 90pt 后松手 `cancel == true`（原有两条测试仍绿）。
- [x] `flutter test` 106 passed；`flutter analyze` 仅既有 3 条 info。

## 5. 回滚

两处改动各自独立：
- 删除 `_onPointerDown` 里的 `hasFocus` 守卫 → 回到「聚焦也录音」。
- 把 `Listener` 移回 `Row` 外层 → 回到「整行长按录音」。

回滚时同步删除 `test/composer_gesture_test.dart` 末尾两条回归用例，并把 `docs/design/components/composer.md` 的相应段落还原。

## 6. 留下的问题（0005 的输入）

「聚焦 + 输入框为空」时，长按既没有文字可选、又不能用语音——两个手势互相让位，让出一个死角。0005 要在以下三种规则里选：

1. 仍以 `hasFocus` 为界，靠可见麦克风键补上聚焦态入口；
2. 把守卫从 `hasFocus` 改成 `text.isNotEmpty`：空输入框长按=说话（即使键盘已开），有文字长按=选字；
3. 彻底取消长按说话，只保留可见入口。

证据（主流 IM 的发送/麦克风切换、press-and-hold 与 tap-to-toggle 的取舍）正在 `design-lab/research/C-voice-entry.md` 汇总，决策落在 0005。
