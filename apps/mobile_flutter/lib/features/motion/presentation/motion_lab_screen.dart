import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';
import '../../../shared/widgets/dream_mark.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/pressable_scale.dart';
import '../../chat/widgets/message_bubble.dart';

class MotionLabScreen extends StatefulWidget {
  const MotionLabScreen({super.key});

  @override
  State<MotionLabScreen> createState() => _MotionLabScreenState();
}

class _MotionLabScreenState extends State<MotionLabScreen> {
  int _replay = 0;
  bool _reduceMotion = false;
  bool _previewDark = true;

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) {
        final theme = Theme.of(context);
        final palette = theme.extension<DreamPalette>()!;
        return Padding(
          padding: EdgeInsets.fromLTRB(
            24,
            8,
            24,
            24 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('底部弹层', style: theme.textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(
                '弹层沿用同一套表面色、圆角与安全区，默认带拖拽把手。',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: palette.textSecondary,
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('知道了'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final systemReduce = MediaQuery.disableAnimationsOf(context);

    return Scaffold(
      appBar: AppBar(leading: const BackButton(), title: const Text('动效预览')),
      body: MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(disableAnimations: _reduceMotion || systemReduce),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _ReduceMotionCard(
                    value: _reduceMotion,
                    onChanged: (v) => setState(() => _reduceMotion = v),
                  ),
                  if (systemReduce) ...[
                    const SizedBox(height: 12),
                    const _SystemReduceBanner(),
                  ],
                  const SizedBox(height: 24),
                  _Section(
                    title: '按压',
                    subtitle: '0.97 缩放 + 触感反馈',
                    child: Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        _DemoPill(
                          label: '主要操作',
                          filled: true,
                          onTap: () => _toast('按压反馈已触发'),
                        ),
                        _DemoPill(
                          label: '次要操作',
                          onTap: () => _toast('按压反馈已触发'),
                        ),
                      ],
                    ),
                  ),
                  _Section(
                    title: '气泡',
                    subtitle: '淡入 + 6px 上移',
                    trailing: TextButton.icon(
                      onPressed: () => setState(() => _replay++),
                      icon: const Icon(Icons.replay_rounded, size: 16),
                      label: const Text('重播'),
                    ),
                    child: Column(
                      key: ValueKey(_replay),
                      children: const [
                        MessageBubble(
                          text: '帮我把这段说明改得更清楚一点。',
                          isUser: true,
                          entrance: true,
                        ),
                        MessageBubble(
                          text: '可以。先删掉重复的修饰，再把结论提到第一句，最后补一个具体例子。',
                          isUser: false,
                          entrance: true,
                        ),
                      ],
                    ),
                  ),
                  _Section(
                    title: '底部弹层',
                    subtitle: 'M3 弹层 + 安全区',
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton(
                        onPressed: _openSheet,
                        child: const Text('打开弹层'),
                      ),
                    ),
                  ),
                  _Section(
                    title: '错误态',
                    subtitle: '失败必须可见，且给下一步',
                    child: ErrorView(
                      title: '连接中断',
                      message: '网络似乎不太稳定。你的输入已保留，可以稍后重试。',
                      onRetry: () => _toast('重试入口（演示）'),
                    ),
                  ),
                  _Section(
                    title: '主题',
                    subtitle: 'DreamPalette 明暗两套预览',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: _PreviewToggle(
                                label: '深色',
                                selected: _previewDark,
                                onTap: () =>
                                    setState(() => _previewDark = true),
                              ),
                            ),
                            const SizedBox(width: DreamSpacing.xs),
                            Expanded(
                              child: _PreviewToggle(
                                label: '浅色',
                                selected: !_previewDark,
                                onTap: () =>
                                    setState(() => _previewDark = false),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: DreamSpacing.sm),
                        Theme(
                          data: _previewDark
                              ? DreamTheme.dark()
                              : DreamTheme.light(),
                          child: const _PaletteSwatch(),
                        ),
                      ],
                    ),
                  ),
                  _Section(
                    title: '流式光标',
                    subtitle: 'brand 1.5pt 竖条 600ms 呼吸',
                    child: const _StreamingCursorPreview(),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Haptics · Fade · Slide · Press',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: palette.textTertiary,
                      letterSpacing: 0.4,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 顶部“减少动效”开关，用 MediaQuery 覆盖 disableAnimations 包裹整页内容。
class _ReduceMotionCard extends StatelessWidget {
  const _ReduceMotionCard({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DreamSpacing.md,
        vertical: DreamSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: palette.sidebar,
        borderRadius: BorderRadius.circular(DreamRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: Row(
        children: [
          Icon(
            Icons.motion_photos_off_rounded,
            size: 20,
            color: palette.textSecondary,
          ),
          const SizedBox(width: DreamSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('减少动效', style: theme.textTheme.labelLarge),
                const SizedBox(height: 2),
                Text(
                  '关闭位移 / 缩放 / 呼吸，验证可关闭路径',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: palette.textTertiary,
                  ),
                ),
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

class _SystemReduceBanner extends StatelessWidget {
  const _SystemReduceBanner();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: palette.brandSoft,
        borderRadius: BorderRadius.circular(DreamRadius.sm),
      ),
      child: Row(
        children: [
          Icon(
            Icons.motion_photos_off_rounded,
            size: 16,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '已检测到系统“减少动效”，动画降级为 0ms。',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.primary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewToggle extends StatelessWidget {
  const _PreviewToggle({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final reduce = MediaQuery.disableAnimationsOf(context);
    return PressableScale(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      child: AnimatedContainer(
        duration: reduce ? Duration.zero : DreamMotion.fast,
        curve: DreamMotion.standard,
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? palette.brandSoft : Colors.transparent,
          borderRadius: BorderRadius.circular(DreamRadius.md),
          border: Border.all(
            color: selected
                ? theme.colorScheme.primary.withValues(alpha: 0.5)
                : palette.border,
          ),
        ),
        child: Text(
          label,
          style: theme.textTheme.labelLarge?.copyWith(
            color: selected ? theme.colorScheme.primary : palette.textSecondary,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

/// 局部 Theme 覆盖下的 DreamPalette 色板，验证明暗两套表面色。
class _PaletteSwatch extends StatelessWidget {
  const _PaletteSwatch();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final entries = <(String, Color)>[
      ('brand', theme.colorScheme.primary),
      ('brandSoft', palette.brandSoft),
      ('textPrimary', palette.textPrimary),
      ('textSecondary', palette.textSecondary),
      ('textTertiary', palette.textTertiary),
      ('border', palette.border),
      ('bubbleUser', palette.bubbleUser),
      ('sidebar', palette.sidebar),
    ];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DreamSpacing.md),
      decoration: BoxDecoration(
        color: theme.scaffoldBackgroundColor,
        borderRadius: BorderRadius.circular(DreamRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: Wrap(
        spacing: DreamSpacing.xs,
        runSpacing: DreamSpacing.sm,
        children: [
          for (final entry in entries)
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 68,
                  height: 40,
                  decoration: BoxDecoration(
                    color: entry.$2,
                    borderRadius: BorderRadius.circular(DreamRadius.sm),
                    border: Border.all(color: palette.border),
                  ),
                ),
                const SizedBox(height: DreamSpacing.xxs),
                Text(
                  entry.$1,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: palette.textTertiary,
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// 流式光标预览：点击“开始呼吸”后 brand 竖条以 600ms 呼吸，减少动效时静止。
class _StreamingCursorPreview extends StatefulWidget {
  const _StreamingCursorPreview();

  @override
  State<_StreamingCursorPreview> createState() =>
      _StreamingCursorPreviewState();
}

class _StreamingCursorPreviewState extends State<_StreamingCursorPreview>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 600),
  );
  late final Animation<double> _breath = Tween<double>(
    begin: 0.2,
    end: 1.0,
  ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

  bool _active = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _toggle() {
    final reduce = MediaQuery.disableAnimationsOf(context);
    setState(() => _active = !_active);
    if (_active && !reduce) {
      _controller.repeat(reverse: true);
    } else {
      _controller.stop();
      _controller.value = 1.0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final reduce = MediaQuery.disableAnimationsOf(context);
    final opacity = (reduce || !_active)
        ? const AlwaysStoppedAnimation<double>(1.0)
        : _breath;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(DreamSpacing.md),
          decoration: BoxDecoration(
            color: palette.sidebar,
            borderRadius: BorderRadius.circular(DreamRadius.md),
            border: Border.all(color: palette.border),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const DreamMark(size: 24),
              const SizedBox(width: DreamSpacing.sm),
              Expanded(
                child: Text(
                  '正在生成回答…',
                  style: theme.textTheme.bodyLarge?.copyWith(
                    color: palette.textPrimary,
                  ),
                ),
              ),
              const SizedBox(width: DreamSpacing.xs),
              FadeTransition(
                opacity: opacity,
                child: Container(
                  width: 1.5,
                  height: 20,
                  color: theme.colorScheme.primary,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: DreamSpacing.sm),
        OutlinedButton.icon(
          onPressed: _toggle,
          icon: Icon(
            _active ? Icons.stop_rounded : Icons.play_arrow_rounded,
            size: 16,
          ),
          label: Text(_active ? '停止' : '开始呼吸'),
        ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.subtitle,
    required this.child,
    this.trailing,
  });

  final String title;
  final String subtitle;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: theme.textTheme.titleMedium),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: palette.textTertiary,
                      ),
                    ),
                  ],
                ),
              ),
              ?trailing,
            ],
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}

class _DemoPill extends StatelessWidget {
  const _DemoPill({
    required this.label,
    required this.onTap,
    this.filled = false,
  });

  final String label;
  final VoidCallback onTap;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return PressableScale(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
        decoration: BoxDecoration(
          color: filled ? theme.colorScheme.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(DreamRadius.pill),
          border: Border.all(
            color: filled ? Colors.transparent : palette.borderStrong,
          ),
        ),
        child: Text(
          label,
          style: theme.textTheme.labelLarge?.copyWith(
            color: filled ? Colors.white : palette.textPrimary,
          ),
        ),
      ),
    );
  }
}
