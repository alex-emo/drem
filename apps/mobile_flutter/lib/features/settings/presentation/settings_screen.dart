import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme_controller.dart';
import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';

/// 与 `pubspec.yaml` 的 `version: 1.7.12+35` 对齐；接入构建注入后再统一替换。
const String kAppVersion = '1.7.12 (35)';

/// 当前重写分支，关于区可复制。
const String kBuildBranch = 'feat/flutter-mobile-rewrite';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _copyBranch(BuildContext context) async {
    await Clipboard.setData(const ClipboardData(text: kBuildBranch));
    if (!context.mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text('已复制分支名')));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final controller = ThemeScope.of(context);

    return Scaffold(
      appBar: AppBar(leading: const BackButton(), title: const Text('设置')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
            children: [
              // 外观
              const _SectionLabel('外观'),
              Text('主题', style: theme.textTheme.labelLarge),
              const SizedBox(height: 4),
              Text(
                '跟随系统，或固定为浅色 / 深色。',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: palette.textTertiary,
                ),
              ),
              const SizedBox(height: 12),
              _ThemeSegmented(
                mode: controller.mode,
                onChanged: controller.setMode,
              ),

              const _GroupDivider(),

              // 体验
              const _SectionLabel('体验'),
              _SettingsRow(
                title: '界面与动效',
                subtitle: '按压、气泡、弹层与错误态',
                onTap: () => context.push('/motion'),
              ),
              Divider(color: palette.border),

              const _GroupDivider(),

              // 关于
              const _SectionLabel('关于'),
              _SettingsRow(
                title: '版本',
                trailing: Text(
                  kAppVersion,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: palette.textSecondary,
                  ),
                ),
              ),
              Divider(color: palette.border),
              _SettingsRow(
                title: '重构分支',
                onTap: () => _copyBranch(context),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      kBuildBranch,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: palette.textSecondary,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      Icons.copy_rounded,
                      size: 16,
                      color: palette.textTertiary,
                    ),
                  ],
                ),
              ),
              Divider(color: palette.border),
              _SettingsRow(
                title: '开源许可',
                onTap: () => showLicensePage(
                  context: context,
                  applicationName: 'Dream',
                  applicationVersion: kAppVersion,
                ),
              ),
              Divider(color: palette.border),

              const SizedBox(height: 24),
              Text(
                'Dream Mobile · Flutter',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: palette.textTertiary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        text,
        style: theme.textTheme.labelMedium?.copyWith(
          color: theme.extension<DreamPalette>()!.textTertiary,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

/// 分组之间的 1px 结构线 + 上下留白。
class _GroupDivider extends StatelessWidget {
  const _GroupDivider();

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<DreamPalette>()!;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DreamSpacing.lg),
      child: Container(height: 1, color: palette.border),
    );
  }
}

/// 三档主题 segmented 控件：当前值高亮 brandSoft，改动立即生效并持久化。
class _ThemeSegmented extends StatelessWidget {
  const _ThemeSegmented({required this.mode, required this.onChanged});

  final ThemeMode mode;
  final ValueChanged<ThemeMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final reduce = MediaQuery.disableAnimationsOf(context);

    return Container(
      padding: const EdgeInsets.all(DreamSpacing.xxs),
      decoration: BoxDecoration(
        color: palette.sidebar,
        borderRadius: BorderRadius.circular(DreamRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: Row(
        children: [
          _segment(
            context,
            value: ThemeMode.system,
            icon: Icons.brightness_auto_rounded,
            label: '系统',
            reduce: reduce,
          ),
          const SizedBox(width: DreamSpacing.xxs),
          _segment(
            context,
            value: ThemeMode.dark,
            icon: Icons.dark_mode_rounded,
            label: '深色',
            reduce: reduce,
          ),
          const SizedBox(width: DreamSpacing.xxs),
          _segment(
            context,
            value: ThemeMode.light,
            icon: Icons.light_mode_rounded,
            label: '浅色',
            reduce: reduce,
          ),
        ],
      ),
    );
  }

  Widget _segment(
    BuildContext context, {
    required ThemeMode value,
    required IconData icon,
    required String label,
    required bool reduce,
  }) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final selected = mode == value;
    return Expanded(
      child: Semantics(
        button: true,
        selected: selected,
        label: label,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {
            HapticFeedback.selectionClick();
            onChanged(value);
          },
          child: AnimatedContainer(
            duration: reduce ? Duration.zero : DreamMotion.fast,
            curve: DreamMotion.standard,
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              color: selected ? palette.brandSoft : Colors.transparent,
              borderRadius: BorderRadius.circular(DreamRadius.sm),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon,
                  size: 20,
                  color: selected
                      ? theme.colorScheme.primary
                      : palette.textSecondary,
                ),
                const SizedBox(height: 4),
                Text(
                  label,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: selected
                        ? theme.colorScheme.primary
                        : palette.textSecondary,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DreamRadius.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: theme.textTheme.labelLarge),
                  if (subtitle != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      subtitle!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: palette.textTertiary,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null)
              trailing!
            else if (onTap != null)
              Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: palette.textTertiary,
              ),
          ],
        ),
      ),
    );
  }
}
