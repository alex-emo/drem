# 0001 · 给「会话」一个可见的把手，把手势降级为加速器

> 状态：**已采纳并实现** · 日期 2026-11-25 · 影响文件：`apps/mobile_flutter/lib/features/chat/**`
> 证据：[research/01-navigation-discoverability.md](../research/01-navigation-discoverability.md)、[research/A-gesture-learnability.md](../research/A-gesture-learnability.md)

## 1. 观察

聊天页顶栏在**有会话**时只有：品牌「Dream」+ 右侧一行不可点的灰字「左滑会话」。设置图标只在 `controller == null` 的 P0 骨架中出现；真实聊天里设置、会话列表、新对话、搜索全部只存在于抽屉内，而抽屉**只能**从左缘 44pt 内右滑打开。

首次进入时还有一条 4 秒横幅：「左滑看会话 · 长按说话」，插在顶栏与内容之间（`Column` 的第二个孩子），出现与消失都会顶动内容。

## 2. 问题

用户不知道「能左滑」只是表象。实质是：**会话列表没有任何可供识别的外形**。不滑的人进不去会话，也进不去设置——功能等于不存在（HCI.TOP C3.20.4 的原话是「从未想到轨迹的人，和做不出轨迹的人，失败看起来一样」）。

横幅修的是「文案没讲」，但问题出在「控件零像素」。

## 3. 证据要点

- NN/g：手势属于 **accelerator**，「discovering them should not be critical to learning and using the interface」，且「introduce accelerators after a user performs the action in the standard way」。→ 手势不能是主路径，教学也应后置。
- NN/g 隐藏导航研究：主导航藏起来，可发现性「cut almost in half」。→ 可见入口优于隐藏入口；Dream 目前比汉堡菜单更极端（零图标）。
- NN/g 识别/回忆：回忆需要的线索更少；常驻视觉线索才是可发现性的载体。→ 一次性横幅收回线索后，界面恢复为零线索。
- Apple HIG Onboarding：「display these instructions near that area」「Teach through interactivity」；NN/g 教练层研究：一次只教一个动作、提示视觉不要像真控件、短时记忆约 20 秒。→ 横幅同时教两个手势、且不在手势发生处。
- Calm Technology：提示应从边缘进入中心再退回边缘，而不是长期占据中心。→ 横幅在无任务时占用内容顶部 4 秒，属打断。

## 4. 备选方案

| 方案 | 内容 | 判定 |
|---|---|---|
| A | 保留横幅，不加按钮 | 否。只补文案，不补外形；且违反「一次只教一个动作」 |
| B | 横幅 + 顶栏菜单按钮 | 否。按钮已经承担可发现性，横幅变成重复噪音，并且仍会顶动布局 |
| C | 顶栏左侧菜单按钮 + 右侧新对话；删除横幅 | **采纳** |
| D | 把会话列表升级为独立页面，顶栏只留品牌 | 暂缓。结构级改动，涉及路由/返回栈/平板布局；不属于本轮 P0，且方案 C 已消除「唯一入口」缺陷 |

## 5. 决定

1. **顶栏左侧**加 44×44 菜单按钮（`Icons.menu_rounded`，20px，tooltip「会话」），`Scaffold.openDrawer()`。左缘右滑保留，`drawerEdgeDragWidth: 44` 不变。
2. **顶栏右侧**在有控制器时放 44×44「新对话」按钮（`Icons.add_comment_outlined`，tooltip「新对话」）；无控制器时仍显示设置图标，保持 P0 骨架可用。
3. 顶栏从 4 个视觉元素（mark、Dream、Spacer、灰字/设置）变为 **两个可点入口 + 品牌**；设置、搜索、会话列表继续留在抽屉，不重复。
4. **删除** `_GestureHint` 组件、`_showGestureHint` 状态、`_gestureHintTimer`、`_maybeShowGestureHint()` 与 `dream-gesture-hint-seen` 写入。布局跳动随之消失。
5. 把 `_ChatHeader` 提取为公开组件 `ChatHeader`（`lib/features/chat/widgets/chat_header.dart`），以便独立测试，并让「顶栏只做两件事」成为可审查的契约。

## 6. 为什么不是「用汉堡菜单藏导航」

NN/g 反对的是把**本来可见**的导航收进图标。Dream 现状是连图标都没有；补一个把手是把可发现性从零拉回可见控件水平，方向与证据一致。抽屉仍是隐藏导航，这一点不否认——它留给方案 D（独立会话页/平板常驻侧栏）解决。

## 7. 后果

- 首次进入不再出现横向横幅；左缘滑动从「唯一入口」变为「加速器」。
- 新用户第一次打开 App 就能看见「会话」和「新对话」两个入口，无需先读一行 4 秒后消失的字。
- 顶栏右侧的「新对话」与抽屉里的「新对话」提交同一 `ChatController.newConversation()`。
- 需要新增测试：菜单按钮打开抽屉、新对话回调触发、无控制器时不显示菜单。
- `docs/design/components/chat-shell.md` 的顶栏章节同步更新。

## 8. 验收（2026-11-25 执行）

- [x] 有控制器时，顶栏存在 tooltip「会话」的按钮；点击后抽屉出现。→ `test/chat_header_test.dart`「点菜单按钮打开会话抽屉」
- [x] 有控制器时，顶栏存在 tooltip「新对话」的按钮；点击后回调被调用且抽屉不打开。→ 同文件「点「新对话」触发回调，不打开抽屉」
- [x] 首次进入聊天页不再出现「左滑看会话 · 长按说话」。→ 同文件第 1 条断言 `findsNothing`，且 `_GestureHint` 类已删除
- [x] `flutter analyze` 无新增问题；`flutter test` 全绿。→ analyze 仅剩既有 3 条 info；test 96 passed（91 + 5）
- [x] 左缘右滑仍能打开抽屉。→ 同文件「左缘右滑仍可打开抽屉（手势作为加速器保留）」

## 9. 遗留

- 若将来要教左缘滑动：按 A 研究，应在用户第一次用菜单打开抽屉**之后**，在抽屉底部给一次 12px 提示（「下次可从屏幕左缘右滑」），成功滑动或手动关闭后永久消失；不要回到开屏横幅。未在本轮实现。
- 顶栏「新对话」是否与输入区争夺注意力，需要真实使用观察；若冲突，回退为只保留菜单按钮。
