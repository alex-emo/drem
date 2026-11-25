import 'package:material_ui/material_ui.dart';

import '../../../design/context_extension.dart';
import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';
import 'markdown/dream_markdown.dart';

/// 单条消息气泡。
///
/// - 用户：右对齐、气泡底 `DreamPalette.bubbleUser`、圆角 md、max 宽 78%。
/// - 助手：左对齐、无气泡底。
/// - `isStreaming`：正文末尾 1.5pt brand 竖条呼吸光标（600ms）。
/// - `reasoning`：思考过程块（仅助手），流式时显示「思考中」。
/// - `errorText != null`：气泡下方错误横幅（danger）+ 重试按钮（220ms 淡入）。
/// - `versionCount > 1`：版本切换器 `‹ 1/2 ›`。
/// - `entrance`：260ms 进入动画（淡入 + 6pt 上移）；减少动效直接到位。
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.text,
    required this.isUser,
    this.entrance = false,
    this.isStreaming = false,
    this.errorText,
    this.onRetry,
    this.reasoning,
    this.versionIndex,
    this.versionCount,
    this.onPrevVersion,
    this.onNextVersion,
  });

  final String text;
  final bool isUser;
  final bool entrance;
  final bool isStreaming;
  final String? errorText;
  final VoidCallback? onRetry;
  final String? reasoning;
  final int? versionIndex;
  final int? versionCount;
  final VoidCallback? onPrevVersion;
  final VoidCallback? onNextVersion;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = context.dreamPalette;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final cursorHeight = theme.textTheme.bodyLarge?.fontSize ?? 16;
    final showReasoning = reasoning != null && reasoning!.isNotEmpty;
    final showVersions =
        versionCount != null && versionCount! > 1 && versionIndex != null;

    final textWidget = DreamMarkdown(
      text: text,
      isUser: isUser,
      trailing: isStreaming
          ? _StreamingCursor(
              color: theme.colorScheme.primary,
              height: cursorHeight,
              animate: !reduceMotion,
            )
          : null,
    );

    final bubble = isUser
        ? Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DreamSpacing.md,
              vertical: DreamSpacing.sm,
            ),
            decoration: BoxDecoration(
              color: palette.bubbleUser,
              borderRadius: BorderRadius.circular(DreamRadius.md),
            ),
            child: textWidget,
          )
        : textWidget;

    return RepaintBoundary(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final maxBubbleWidth = constraints.maxWidth * 0.78;

          Widget body = isUser
              ? ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: maxBubbleWidth),
                  child: bubble,
                )
              : bubble;

          body = Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: isUser
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              if (showReasoning && !isUser)
                ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: maxBubbleWidth),
                  child: _ThinkingBlock(
                    text: reasoning!,
                    isStreaming: isStreaming,
                    palette: palette,
                  ),
                ),
              body,
              if (showVersions)
                _VersionSwitcher(
                  index: versionIndex!,
                  count: versionCount!,
                  onPrev: onPrevVersion,
                  onNext: onNextVersion,
                  palette: palette,
                ),
              if (errorText != null)
                ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: maxBubbleWidth),
                  child: _ErrorBanner(
                    text: errorText!,
                    onRetry: onRetry,
                    reduceMotion: reduceMotion,
                  ),
                ),
            ],
          );

          if (entrance && !reduceMotion) {
            body = TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: 1),
              duration: DreamMotion.bubble,
              curve: DreamMotion.standard,
              child: body,
              builder: (context, value, child) {
                return Opacity(
                  opacity: value,
                  child: Transform.translate(
                    offset: Offset(0, 6 * (1 - value)),
                    child: child,
                  ),
                );
              },
            );
          }

          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Align(
              alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
              child: body,
            ),
          );
        },
      ),
    );
  }
}

/// 思考过程块：流式时显示「思考中」，结束后显示「思考过程」。
class _ThinkingBlock extends StatelessWidget {
  const _ThinkingBlock({
    required this.text,
    required this.isStreaming,
    required this.palette,
  });

  final String text;
  final bool isStreaming;
  final DreamPalette palette;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: DreamSpacing.xs),
      padding: const EdgeInsets.all(DreamSpacing.sm),
      decoration: BoxDecoration(
        color: palette.code,
        borderRadius: BorderRadius.circular(DreamRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.psychology_outlined,
                size: 14,
                color: palette.textTertiary,
              ),
              const SizedBox(width: DreamSpacing.xxs),
              Text(
                isStreaming ? '思考中' : '思考过程',
                style: TextStyle(color: palette.textTertiary, fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: DreamSpacing.xxs),
          Text(
            text,
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: 13,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

/// 版本切换器：`‹ 1/2 ›`。
class _VersionSwitcher extends StatelessWidget {
  const _VersionSwitcher({
    required this.index,
    required this.count,
    required this.palette,
    this.onPrev,
    this.onNext,
  });

  final int index;
  final int count;
  final DreamPalette palette;
  final VoidCallback? onPrev;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: DreamSpacing.xs),
      padding: const EdgeInsets.symmetric(
        horizontal: DreamSpacing.xxs,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: palette.code,
        borderRadius: BorderRadius.circular(DreamRadius.sm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: '上一个版本',
            visualDensity: VisualDensity.compact,
            iconSize: 16,
            color: palette.textSecondary,
            icon: const Icon(Icons.chevron_left_rounded),
            onPressed: onPrev,
          ),
          Text(
            '${index + 1}/$count',
            style: TextStyle(color: palette.textSecondary, fontSize: 12),
          ),
          IconButton(
            tooltip: '下一个版本',
            visualDensity: VisualDensity.compact,
            iconSize: 16,
            color: palette.textSecondary,
            icon: const Icon(Icons.chevron_right_rounded),
            onPressed: onNext,
          ),
        ],
      ),
    );
  }
}

/// 流式呼吸光标：1.5pt brand 竖条，600ms 呼吸；减少动效时静态显示。
class _StreamingCursor extends StatefulWidget {
  const _StreamingCursor({
    required this.color,
    required this.height,
    required this.animate,
  });

  final Color color;
  final double height;
  final bool animate;

  @override
  State<_StreamingCursor> createState() => _StreamingCursorState();
}

class _StreamingCursorState extends State<_StreamingCursor>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: DreamMotion.cursor,
    );
    if (widget.animate) {
      _controller.repeat(reverse: true);
    } else {
      _controller.value = 1;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _controller.drive(Tween(begin: 0.3, end: 1.0)),
      child: Container(
        width: 1.5,
        height: widget.height,
        margin: const EdgeInsets.only(left: 3),
        decoration: BoxDecoration(
          color: widget.color,
          borderRadius: BorderRadius.circular(1),
        ),
      ),
    );
  }
}

/// 错误横幅：danger 底 + 重试按钮，220ms 淡入。
class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({
    required this.text,
    required this.onRetry,
    required this.reduceMotion,
  });

  final String text;
  final VoidCallback? onRetry;
  final bool reduceMotion;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final danger = theme.colorScheme.error;

    final banner = Container(
      margin: const EdgeInsets.only(top: DreamSpacing.xs),
      padding: const EdgeInsets.fromLTRB(
        DreamSpacing.sm,
        DreamSpacing.xs,
        DreamSpacing.xxs,
        DreamSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: danger.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(DreamRadius.sm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline_rounded, size: 16, color: danger),
          const SizedBox(width: DreamSpacing.xxs),
          Flexible(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(color: danger),
            ),
          ),
          TextButton(
            onPressed: onRetry,
            style: TextButton.styleFrom(
              foregroundColor: danger,
              disabledForegroundColor: danger.withValues(alpha: 0.5),
              visualDensity: VisualDensity.compact,
              // 44×44 起（omd:feel 命中区下限）；错误横幅本身矮，靠
              // tapTargetSize 之外的显式高度保证可点。
              minimumSize: const Size(44, 44),
              padding: const EdgeInsets.symmetric(horizontal: DreamSpacing.xs),
            ),
            child: const Text('重试'),
          ),
        ],
      ),
    );

    if (reduceMotion) {
      return banner;
    }
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: DreamMotion.errorIn,
      curve: DreamMotion.standard,
      child: banner,
      builder: (context, value, child) {
        return Opacity(opacity: value, child: child);
      },
    );
  }
}
