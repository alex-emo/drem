import 'package:material_ui/material_ui.dart';

import '../../../design/context_extension.dart';
import '../../../design/tokens.dart';
import '../../../shared/widgets/pressable_scale.dart';

/// 空态建议：标题 + 副标题 + 点击后回填输入框的完整文本（fill）。
class PromptSuggestion {
  const PromptSuggestion({
    required this.title,
    required this.subtitle,
    required this.fill,
  });

  final String title;
  final String subtitle;
  final String fill;
}

/// 聊天空态：左对齐编辑式布局。
///
/// - 主标题 displaySmall + 副标题 bodyMedium + 编号建议 01–04 + 免责声明。
/// - 建议逐条淡入 + 上移 6pt，间隔 [DreamMotion.staggerStep]，仅首屏一次。
/// - 减少动效时直达终态，不做位移/透明度过渡。
class ChatEmptyState extends StatelessWidget {
  const ChatEmptyState({
    super.key,
    required this.prompts,
    required this.onPromptTap,
  });

  /// 建议列表，最多 4 条。
  final List<PromptSuggestion> prompts;

  /// 点击建议后回调，收到 [PromptSuggestion.fill] 文本。
  final ValueChanged<String> onPromptTap;

  @override
  Widget build(BuildContext context) {
    return _EmptyStateBody(prompts: prompts, onPromptTap: onPromptTap);
  }
}

class _EmptyStateBody extends StatefulWidget {
  const _EmptyStateBody({required this.prompts, required this.onPromptTap});

  final List<PromptSuggestion> prompts;
  final ValueChanged<String> onPromptTap;

  @override
  State<_EmptyStateBody> createState() => _EmptyStateBodyState();
}

class _EmptyStateBodyState extends State<_EmptyStateBody>
    with SingleTickerProviderStateMixin {
  late final AnimationController _intro;

  /// 动画条目数：主标题 + 副标题 + N 条建议。
  int get _itemCount => widget.prompts.length + 2;

  @override
  void initState() {
    super.initState();
    // 总时长 = 单条进入时长 + 间隔 ×（条目数 - 1），间隔用 staggerStep token。
    final total = DreamMotion.page + DreamMotion.staggerStep * (_itemCount - 1);
    _intro = AnimationController(vsync: this, duration: total)..forward();
  }

  @override
  void dispose() {
    _intro.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = context.dreamPalette;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 560;
        final horizontal = compact
            ? DreamSpacing.pageMargin
            : DreamSpacing.pageMarginWide;

        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            horizontal,
            compact ? 36 : 68,
            horizontal,
            20,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Reveal(
                controller: _intro,
                index: 0,
                enabled: !reduceMotion,
                child: Text(
                  '今天想问 Dream 什么？',
                  style: compact
                      ? theme.textTheme.displaySmall?.copyWith(fontSize: 30)
                      : theme.textTheme.displaySmall,
                ),
              ),
              const SizedBox(height: DreamSpacing.sm),
              _Reveal(
                controller: _intro,
                index: 1,
                enabled: !reduceMotion,
                child: Text(
                  '从一个问题开始。',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: palette.textSecondary,
                  ),
                ),
              ),
              SizedBox(height: compact ? 32 : 44),
              Container(height: 1, color: palette.border),
              for (var i = 0; i < widget.prompts.length; i++) ...[
                _Reveal(
                  controller: _intro,
                  index: 2 + i,
                  enabled: !reduceMotion,
                  child: _PromptRow(
                    index: i + 1,
                    suggestion: widget.prompts[i],
                    onTap: () => widget.onPromptTap(widget.prompts[i].fill),
                  ),
                ),
                if (i != widget.prompts.length - 1)
                  Container(height: 1, color: palette.border),
              ],
              const SizedBox(height: DreamSpacing.lg),
              Text(
                'Dream 可能会犯错，请核实重要信息。',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: palette.textTertiary,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// 单条进入动画：淡入 + 上移 6pt，按 index 用 staggerStep 错开；减少动效时直达。
class _Reveal extends StatelessWidget {
  const _Reveal({
    required this.controller,
    required this.index,
    required this.child,
    required this.enabled,
  });

  final AnimationController controller;
  final int index;
  final Widget child;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    if (!enabled) {
      return child;
    }
    final totalMs = controller.duration!.inMilliseconds;
    final startMs = index * DreamMotion.staggerStep.inMilliseconds;
    final endMs = startMs + DreamMotion.page.inMilliseconds;
    final start = totalMs == 0
        ? 0.0
        : (startMs / totalMs).clamp(0.0, 1.0).toDouble();
    final end = totalMs == 0
        ? 1.0
        : (endMs / totalMs).clamp(0.0, 1.0).toDouble();
    final animation = CurvedAnimation(
      parent: controller,
      curve: Interval(start, end, curve: DreamMotion.standard),
    );
    return AnimatedBuilder(
      animation: animation,
      child: child,
      builder: (context, child) {
        return Opacity(
          opacity: animation.value,
          child: Transform.translate(
            offset: Offset(0, 6 * (1 - animation.value)),
            child: child,
          ),
        );
      },
    );
  }
}

/// 单条建议行：编号 01–04 + 标题 + 副标题，左对齐，点击回填。
class _PromptRow extends StatelessWidget {
  const _PromptRow({
    required this.index,
    required this.suggestion,
    required this.onTap,
  });

  final int index;
  final PromptSuggestion suggestion;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = context.dreamPalette;
    return PressableScale(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 17),
        child: Row(
          children: [
            SizedBox(
              width: 34,
              child: Text(
                index.toString().padLeft(2, '0'),
                style: theme.textTheme.labelMedium?.copyWith(
                  color: theme.colorScheme.primary,
                  letterSpacing: 0.8,
                ),
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(suggestion.title, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 3),
                  Text(
                    suggestion.subtitle,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: palette.textTertiary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
