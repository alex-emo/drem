import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme_controller.dart';
import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';
import '../../../shared/widgets/pressable_scale.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

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
              const _SectionLabel('外观'),
              Text('主题', style: theme.textTheme.titleMedium),
              const SizedBox(height: 6),
              Text(
                '跟随系统，或固定为浅色 / 深色。',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: palette.textTertiary,
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _ThemeChoice(
                      icon: Icons.brightness_auto_rounded,
                      label: '系统',
                      selected: controller.mode == ThemeMode.system,
                      onTap: () => controller.setMode(ThemeMode.system),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _ThemeChoice(
                      icon: Icons.light_mode_rounded,
                      label: '浅色',
                      selected: controller.mode == ThemeMode.light,
                      onTap: () => controller.setMode(ThemeMode.light),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _ThemeChoice(
                      icon: Icons.dark_mode_rounded,
                      label: '深色',
                      selected: controller.mode == ThemeMode.dark,
                      onTap: () => controller.setMode(ThemeMode.dark),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),
              const _SectionLabel('体验'),
              _SettingsRow(
                icon: Icons.animation_rounded,
                title: '界面与动效',
                subtitle: '按压、气泡、弹层与错误态',
                onTap: () => context.push('/motion'),
              ),
              Divider(color: palette.border),
              const SizedBox(height: 32),
              const _SectionLabel('关于'),
              _SettingsRow(
                icon: Icons.info_outline_rounded,
                title: '版本',
                trailing: Text(
                  '1.7.12 (35)',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: palette.textTertiary,
                  ),
                ),
              ),
              Divider(color: palette.border),
              _SettingsRow(
                icon: Icons.description_outlined,
                title: '开源许可',
                onTap: () => showLicensePage(
                  context: context,
                  applicationName: 'Dream',
                  applicationVersion: '1.7.12 (35)',
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

class _ThemeChoice extends StatelessWidget {
  const _ThemeChoice({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return PressableScale(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      child: AnimatedContainer(
        duration: DreamMotion.fast,
        curve: DreamMotion.standard,
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: selected ? palette.brandSoft : Colors.transparent,
          borderRadius: BorderRadius.circular(DreamRadius.md),
          border: Border.all(
            color: selected
                ? theme.colorScheme.primary.withValues(alpha: 0.5)
                : palette.border,
          ),
        ),
        child: Column(
          children: [
            Icon(
              icon,
              size: 20,
              color: selected
                  ? theme.colorScheme.primary
                  : palette.textSecondary,
            ),
            const SizedBox(height: 8),
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
    );
  }
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.title,
    this.icon,
    this.subtitle,
    this.trailing,
    this.onTap,
  });

  final String title;
  final IconData? icon;
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
            if (icon != null) ...[
              Icon(icon, size: 20, color: palette.textSecondary),
              const SizedBox(width: 14),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: theme.textTheme.bodyLarge),
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
