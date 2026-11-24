import 'package:material_ui/material_ui.dart';

import '../../design/dream_theme.dart';
import '../../design/tokens.dart';

class ErrorView extends StatelessWidget {
  const ErrorView({
    super.key,
    required this.title,
    required this.message,
    this.onRetry,
  });

  final String title;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DreamSpacing.lg),
      decoration: BoxDecoration(
        color: palette.sidebar,
        borderRadius: BorderRadius.circular(DreamRadius.lg),
        border: Border.all(color: palette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: theme.colorScheme.error.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.cloud_off_rounded,
              size: 20,
              color: theme.colorScheme.error,
            ),
          ),
          const SizedBox(height: DreamSpacing.md),
          Text(title, style: theme.textTheme.titleMedium),
          const SizedBox(height: DreamSpacing.xxs),
          Text(
            message,
            style: theme.textTheme.bodySmall?.copyWith(
              color: palette.textSecondary,
            ),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: DreamSpacing.md),
            FilledButton.tonal(onPressed: onRetry, child: const Text('重试')),
          ],
        ],
      ),
    );
  }
}
