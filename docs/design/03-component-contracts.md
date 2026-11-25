# 03 · 组件契约

> 冻结的 widget API。改签名必须先通知 Lead，并同步更新本文件与使用处。

## 1. 组件树

```text
DreamApp (MaterialApp.router + ThemeScope)
├─ ChatScreen
│  ├─ ChatTopBar
│  ├─ ChatEmptyState          (无消息时)
│  ├─ MessageList             (有消息时)
│  └─ Composer
├─ SettingsScreen
│  └─ SettingsSection / rows
└─ MotionLabScreen            (开发用，不进发布)
```

## 2. 文件边界（write scopes）

| Owner | 文件 |
|---|---|
| design-system | `lib/design/**`、`lib/shared/widgets/**` |
| composer-messages | `lib/features/chat/widgets/composer.dart`、`message_list.dart`、`message_bubble.dart`、`chat_message.dart` |
| chat-shell | `lib/features/chat/presentation/**`、`lib/features/chat/widgets/empty_state.dart` |
| settings-motion | `lib/features/settings/**`、`lib/features/motion/**` |
| Lead | `lib/app/**`、`lib/main.dart`、`test/**`（可协调） |

任何人不得改别人 owner 的文件；跨文件需要先创建 task 依赖或通知 Lead。

## 3. 冻结 API

### 数据模型（`lib/features/chat/widgets/chat_message.dart`）

```dart
enum ChatRole { user, assistant }

class ChatMessage {
  final String id;
  final ChatRole role;
  final String text;
  final bool isStreaming;
  final bool isError;
  final DateTime createdAt;
  const ChatMessage({ ... });
}
```

### Composer（`lib/features/chat/widgets/composer.dart`）

```dart
class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.canSend,
    required this.onSend,
    required this.onAttach,
    this.onFocusChanged,
    this.hintText = '给 Dream 发送消息',
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool canSend;
  final ValueChanged<String> onSend;      // 传输入文本
  final VoidCallback onAttach;
  final ValueChanged<bool>? onFocusChanged;
  final String hintText;
}
```

行为：多行自动增高（最大 5 行后内部滚动）；发送清空输入并保持焦点；未接入能力只放“附件”占位（点击给 P1 提示，不抛错）。

### MessageList（`lib/features/chat/widgets/message_list.dart`）

```dart
class MessageList extends StatelessWidget {
  const MessageList({
    super.key,
    required this.messages,
    this.empty,
    this.bottomPadding = 24,
  });
}
```

### MessageBubble（`lib/features/chat/widgets/message_bubble.dart`）

```dart
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.text,
    required this.isUser,
    this.entrance = false,
    this.isStreaming = false,
    this.errorText,
  });
}
```

### ChatEmptyState（`lib/features/chat/widgets/empty_state.dart`）

```dart
class ChatEmptyState extends StatelessWidget {
  const ChatEmptyState({super.key, required this.prompts, required this.onPromptTap});
  final List<String> prompts;            // 最多 4 条
  final ValueChanged<String> onPromptTap;
}
```

## 4. 状态约定

每个组件至少覆盖：

- 默认 / 空态
- 加载（骨架，非转圈）
- 流式（光标 + 只追加）
- 错误（错误横幅 + 重试）
- 禁用（发送按钮灰态、附件占位）
- 深色 / 浅色 / 减少动效 / 大字号

## 5. 主题约定

- feature 层禁止 `Color(0x...)`、`TextStyle(fontSize: ...)` 硬编码。
- 一律经 `Theme.of(context)` / `DreamPalette.of(context)` 取。
- 间距/圆角/动效走 `lib/design/tokens.dart`。

## 6. 验收（每个任务）

- `dart format .` 无改动（或已格式化）
- `flutter analyze` 0 issue
- 本任务相关 `flutter test` 通过
- 未改他人 owner 文件、未新增依赖、未改 master
