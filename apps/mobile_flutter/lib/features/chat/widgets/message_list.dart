import 'package:material_ui/material_ui.dart';

import 'chat_message.dart';
import 'message_bubble.dart';

/// 消息列表：`ListView.builder`，底部 padding，新消息在底；
/// `empty` 非空且无消息时替代列表。
class MessageList extends StatelessWidget {
  const MessageList({
    super.key,
    required this.messages,
    this.empty,
    this.bottomPadding = 24,
  });

  final List<ChatMessage> messages;
  final Widget? empty;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty && empty != null) {
      return empty!;
    }
    return ListView.builder(
      padding: EdgeInsets.only(bottom: bottomPadding),
      itemCount: messages.length,
      itemBuilder: (context, index) {
        final message = messages[index];
        return MessageBubble(
          key: ValueKey(message.id),
          text: message.text,
          isUser: message.role == ChatRole.user,
          isStreaming: message.isStreaming,
          errorText: message.isError ? message.text : null,
        );
      },
    );
  }
}
