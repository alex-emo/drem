import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';
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
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    return Scaffold(
      appBar: AppBar(leading: const BackButton(), title: const Text('动效预览')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
            children: [
              Text('动效基线', style: theme.textTheme.headlineMedium),
              const SizedBox(height: 6),
              Text(
                '120–320ms，标准曲线。系统开启“减少动效”时自动关闭。',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: palette.textTertiary,
                ),
              ),
              if (reduceMotion) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
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
                ),
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
                    _DemoPill(label: '次要操作', onTap: () => _toast('按压反馈已触发')),
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
                    MessageBubble(text: '帮我把这段说明改得更清楚一点。', isUser: true),
                    MessageBubble(text: '可以。先删掉重复的修饰，再把结论提到第一句，最后补一个具体例子。'),
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
