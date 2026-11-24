# Dream Mobile · Flutter

Dream 的 iOS / Android 重写分支（`feat/flutter-mobile-rewrite`）的 P0 骨架。

## 当前状态

P0 只做“可运行、可验证的体验基线”，**尚未接入真实数据与 SSE**：

- 设计 token、明暗主题、主题持久化
- go_router 路由：`/`、`/settings`、`/motion`
- 聊天壳：品牌顶栏、编辑式空态、编号建议、输入框与发送按钮
- 设置：跟随系统 / 浅色 / 深色
- 动效预览：按压、气泡、底部弹层、错误态
- widget 测试：空态填入、主题切换、动效页导航

发送按钮当前只展示 P1 提示，不会上传任何内容。

## 视觉方向

不逐像素复刻 web / DeepSeek：

- 功能映射保持：聊天、设置、动效反馈与后续数据能力一一对应
- 视觉用 Flutter 自有语言：更安静的底色、编辑式左对齐空态、编号建议、细线输入区、低饱和用户气泡
- 品牌蓝只作为强调色，不做大面积渐变卡片
- 所有动效尊重系统“减少动效”

## 运行

仓库内固定 Flutter 3.50.1（本地 `.flutter/`，不提交）：

```bash
export PATH="$PWD/../../.flutter/bin:$PATH"
flutter pub get
flutter run
```

当前机器使用 `PUB_HOSTED_URL=https://pub.flutter-io.cn` 时可正常拉包。

验证：

```bash
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
```

## 目录

```text
lib/
  app/            app、router、主题 controller
  design/         tokens、DreamPalette、ThemeData
  features/
    chat/         聊天壳、空态、输入、气泡
    settings/     主题与关于
    motion/       动效预览
  shared/widgets/ DreamMark、PressableScale、ErrorView
test/app_test.dart
```

## 下一步（P1）

- `POST /api/v1/chat` SSE 解析与取消
- 会话/消息本地库（SQLite）与分支模型
- 登录、云备份、附件、ASR
- 与 server 的接口对齐后再决定状态管理方案
