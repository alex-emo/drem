import 'package:material_ui/material_ui.dart';

import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';
import '../../../shared/widgets/dream_mark.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.text,
    this.isUser = false,
    this.entrance = true,
  });

  final String text;
  final bool isUser;
  final bool entrance;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    final bubble = isUser
        ? Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DreamSpacing.md,
              vertical: DreamSpacing.sm,
            ),
            decoration: BoxDecoration(
              color: palette.bubbleUser,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(DreamRadius.lg),
                topRight: Radius.circular(DreamRadius.lg),
                bottomLeft: Radius.circular(DreamRadius.lg),
                bottomRight: Radius.circular(6),
              ),
            ),
            child: Text(
              text,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: palette.textPrimary,
              ),
            ),
          )
        : Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const DreamMark(size: 24),
              const SizedBox(width: DreamSpacing.sm),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    text,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: palette.textPrimary,
                      height: 1.6,
                    ),
                  ),
                ),
              ),
            ],
          );

    Widget content = bubble;
    if (entrance && !reduceMotion) {
      content = TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: DreamMotion.bubble,
        curve: DreamMotion.standard,
        child: bubble,
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
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: content,
        ),
      ),
    );
  }
}
