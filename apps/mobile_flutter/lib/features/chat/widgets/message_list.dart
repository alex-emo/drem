import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/models.dart';
import '../../../design/dream_scroll_physics.dart';
import 'message_bubble.dart';

/// 消息列表：`ListView.builder`，底部 padding，新消息在底；
/// `empty` 非空且无消息时替代列表。
///
/// - 长按消息弹出操作：复制 / 编辑（仅 user）/ 重新生成（仅 assistant）。
/// - [versions]：`buildVersions(allMessages)` 结果，用于版本切换器。
class MessageList extends StatelessWidget {
  const MessageList({
    super.key,
    required this.messages,
    this.empty,
    this.bottomPadding = 24,
    this.versions,
    this.onEdit,
    this.onRegenerate,
    this.onVersionSelect,
    this.controller,
  });

  final List<Message> messages;
  final Widget? empty;
  final double bottomPadding;
  final Map<String, ({List<String> ids, int index})>? versions;
  final ValueChanged<String>? onEdit;
  final ValueChanged<String>? onRegenerate;
  final ValueChanged<String>? onVersionSelect;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty && empty != null) {
      return empty!;
    }
    return _OverscrollHaptics(
      child: ListView.builder(
        controller: controller,
        physics: dreamScrollPhysics,
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.only(bottom: bottomPadding),
        itemCount: messages.length,
        itemBuilder: (context, index) =>
            RepaintBoundary(child: _buildItem(context, messages[index])),
      ),
    );
  }

  Widget _buildItem(BuildContext context, Message message) {
    final version = versions?[message.id];
    final vIndex = version?.index;
    final vCount = version?.ids.length ?? 1;
    final prevId = (version != null && version.index > 0)
        ? version.ids[version.index - 1]
        : null;
    final nextId = (version != null && version.index < version.ids.length - 1)
        ? version.ids[version.index + 1]
        : null;

    final isUser = message.role == ChatRole.user;
    final canEdit = isUser && onEdit != null;
    final canRegenerate =
        message.role == ChatRole.assistant &&
        message.parentId != null &&
        onRegenerate != null;

    final bubble = MessageBubble(
      key: ValueKey(message.id),
      text: message.content,
      isUser: isUser,
      isStreaming: message.status == MessageStatus.streaming,
      errorText: message.status == MessageStatus.error
          ? (message.error ?? '生成失败')
          : null,
      onRetry: canRegenerate ? () => onRegenerate!(message.id) : null,
      reasoning: message.reasoning,
      versionIndex: vIndex,
      versionCount: vCount,
      onPrevVersion: prevId != null && onVersionSelect != null
          ? () => onVersionSelect!(prevId)
          : null,
      onNextVersion: nextId != null && onVersionSelect != null
          ? () => onVersionSelect!(nextId)
          : null,
    );

    final row = canEdit || canRegenerate
        ? GestureDetector(
            onLongPress: () => _showActions(
              context,
              message,
              canEdit: canEdit,
              canRegenerate: canRegenerate,
            ),
            child: bubble,
          )
        : bubble;

    // 阅读边距：正文不贴屏幕边缘。
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: row,
    );
  }

  void _showActions(
    BuildContext context,
    Message message, {
    required bool canEdit,
    required bool canRegenerate,
  }) {
    HapticFeedback.mediumImpact();
    showModalBottomSheet<void>(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.copy_rounded),
                title: const Text('复制'),
                onTap: () {
                  Clipboard.setData(ClipboardData(text: message.content));
                  Navigator.of(context).pop();
                },
              ),
              if (canEdit)
                ListTile(
                  leading: const Icon(Icons.edit_rounded),
                  title: const Text('编辑'),
                  onTap: () {
                    Navigator.of(context).pop();
                    onEdit!(message.id);
                  },
                ),
              if (canRegenerate)
                ListTile(
                  leading: const Icon(Icons.refresh_rounded),
                  title: const Text('重新生成'),
                  onTap: () {
                    Navigator.of(context).pop();
                    onRegenerate!(message.id);
                  },
                ),
            ],
          ),
        );
      },
    );
  }
}

/// 顶部越界时给一次轻触，不按帧触发；一次手势最多一次。
class _OverscrollHaptics extends StatefulWidget {
  const _OverscrollHaptics({required this.child});

  final Widget child;

  @override
  State<_OverscrollHaptics> createState() => _OverscrollHapticsState();
}

class _OverscrollHapticsState extends State<_OverscrollHaptics> {
  bool _fired = false;

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (notification is ScrollStartNotification) {
          _fired = false;
        } else if (notification is OverscrollNotification &&
            notification.overscroll < 0 &&
            !_fired) {
          _fired = true;
          HapticFeedback.selectionClick();
        }
        return false;
      },
      child: widget.child,
    );
  }
}
