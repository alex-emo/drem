import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/theme_controller.dart';
import '../../../core/models.dart';
import '../../../design/dream_theme.dart';
import '../../../services/api_client.dart';
import '../../../design/tokens.dart';
import '../../cloud/cloud_sync_controller.dart';
import '../../import/archive_import_controller.dart';
import '../../import/share_import_controller.dart';
import '../../update/update_controller.dart';

/// 与 `pubspec.yaml` 的 `version: 1.7.12+35` 对齐；接入构建注入后再统一替换。
const String kAppVersion = '1.7.12 (35)';

/// 当前重写分支，关于区可复制。
const String kBuildBranch = 'feat/flutter-mobile-rewrite';

/// 内容宽度存储键与默认值。
const String _contentWidthKey = 'dream-content-width';
const double _contentWidthMin = 560;
const double _contentWidthMax = 1100;
const double _contentWidthDefault = 680;

/// 设置页。
///
/// 控制器均为可选注入：`lib/app/router.dart` 以 `const SettingsScreen()` 构造，
/// 因此未接入的控制器为 null，对应分区仍渲染但操作给出“未接入”提示。
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    this.cloud,
    this.update,
    this.shareImport,
    this.archiveImport,
    this.user,
    this.onLogout,
    this.api,
  });

  final CloudSyncController? cloud;
  final UpdateController? update;
  final ShareImportController? shareImport;
  final ArchiveImportController? archiveImport;
  final AuthUser? user;
  final VoidCallback? onLogout;

  /// 反馈提交依赖（只读）；由 Lead 注入共享 ApiClient。
  final ApiClient? api;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  double _contentWidth = _contentWidthDefault;

  @override
  void initState() {
    super.initState();
    unawaited(_loadContentWidth());
  }

  Future<void> _loadContentWidth() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getDouble(_contentWidthKey);
    if (stored != null &&
        stored >= _contentWidthMin &&
        stored <= _contentWidthMax) {
      if (mounted) setState(() => _contentWidth = stored);
    }
  }

  Future<void> _setContentWidth(double value) async {
    if (!mounted) return;
    setState(() => _contentWidth = value);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_contentWidthKey, value);
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _copyBranch() async {
    await Clipboard.setData(const ClipboardData(text: kBuildBranch));
    _toast('已复制分支名');
  }

  Future<void> _export() async {
    final cloud = widget.cloud;
    if (cloud == null) return _toast('云同步尚未接入');
    try {
      await cloud.exportToFile();
      _toast('已导出加密备份');
    } catch (e) {
      _toast('导出失败：$e');
    }
  }

  Future<void> _importBackupFile() async {
    final cloud = widget.cloud;
    if (cloud == null) return _toast('云同步尚未接入');
    final result = await FilePicker.pickFile(
      dialogTitle: '选择备份文件',
      type: FileType.custom,
      allowedExtensions: const ['dream', 'json', 'gz'],
    );
    final path = result?.path;
    if (path == null) return;
    try {
      await cloud.importFromFile(path);
      _toast('备份已恢复');
    } catch (e) {
      _toast('导入失败：$e');
    }
  }

  Future<void> _importShare() async {
    final controller = widget.shareImport;
    if (controller == null) return _toast('分享导入尚未接入');
    final url = await _promptForText(title: '导入分享', label: '分享链接或分享 ID');
    if (url == null || url.trim().isEmpty) return;
    try {
      await controller.importShare(url.trim());
      _toast('分享已导入');
    } catch (e) {
      _toast('导入失败：$e');
    }
  }

  Future<void> _importArchive() async {
    final controller = widget.archiveImport;
    if (controller == null) return _toast('归档导入尚未接入');
    final url = await _promptForText(title: '导入归档', label: '归档链接');
    if (url == null || url.trim().isEmpty) return;
    try {
      final stats = await controller.importArchive(url.trim());
      _toast('已导入 ${stats.conversations} 个会话、${stats.messages} 条消息');
    } catch (e) {
      _toast('导入失败：$e');
    }
  }

  Future<void> _importArchiveZip() async {
    final controller = widget.archiveImport;
    if (controller == null) return _toast('归档导入尚未接入');
    final result = await FilePicker.pickFile(
      dialogTitle: '选择 ZIP 归档',
      type: FileType.custom,
      allowedExtensions: const ['zip'],
    );
    final path = result?.path;
    if (path == null) return;
    try {
      final stats = await controller.importArchiveZip(path);
      _toast('已导入 ${stats.conversations} 个会话、${stats.messages} 条消息');
    } catch (e) {
      _toast('导入失败：$e');
    }
  }

  Future<void> _clearLocalData() async {
    final cloud = widget.cloud;
    if (cloud == null) return _toast('云同步尚未接入');
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('清空本地数据？'),
        content: const Text('将删除本机全部会话与消息，此操作不可撤销。云端加密备份不受影响。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(backgroundColor: DreamColors.danger),
            child: const Text('清空'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await cloud.clearLocalData();
      _toast('本地数据已清空');
    } catch (e) {
      _toast('清空失败：$e');
    }
  }

  Future<void> _logout() async {
    final onLogout = widget.onLogout;
    if (onLogout == null) return _toast('账号尚未接入');
    onLogout();
  }

  Future<void> _checkUpdate() async {
    final update = widget.update;
    if (update == null) return _toast('更新检查尚未接入');
    try {
      final release = await update.check();
      if (release == null) {
        _toast('已是最新版本');
        return;
      }
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('发现新版本 ${release.version}'),
          content: Text(release.notes.isEmpty ? '有新版本可用。' : release.notes),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('稍后'),
            ),
            FilledButton(
              onPressed: () async {
                Navigator.pop(context);
                try {
                  await update.downloadAndInstall(release);
                  _toast('下载完成，请在系统提示中安装；如无提示，请用浏览器打开 ${release.apkUrl}');
                } catch (e) {
                  _toast('更新失败：$e');
                }
              },
              child: const Text('下载更新'),
            ),
          ],
        ),
      );
    } catch (e) {
      _toast('检查更新失败：$e');
    }
  }

  Future<void> _feedback() async {
    final api = widget.api;
    if (api == null) return _toast('反馈尚未接入');
    final result = await showDialog<(String, String)>(
      context: context,
      builder: (context) => _FeedbackDialog(),
    );
    if (result == null) return;
    final (description, reproducible) = result;
    try {
      await api.feedback({
        'platform': 'app',
        'os': 'Flutter',
        'osVersion': '',
        'appVersion': kAppVersion,
        'description': description,
        'reproducible': reproducible,
      });
      _toast('反馈已提交，感谢你的反馈');
    } catch (e) {
      _toast('提交失败：$e');
    }
  }

  Future<String?> _promptForText({
    required String title,
    required String label,
  }) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(labelText: label),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('确定'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final themeController = ThemeScope.of(context);

    return Scaffold(
      appBar: AppBar(leading: const BackButton(), title: const Text('设置')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 通用
                const _SectionLabel('通用'),
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
                  mode: themeController.mode,
                  onChanged: themeController.setMode,
                ),
                const SizedBox(height: 20),
                Text('内容宽度', style: theme.textTheme.labelLarge),
                const SizedBox(height: 4),
                Text(
                  '聊天区域最大宽度（${_contentWidth.round()} px）。',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: palette.textTertiary,
                  ),
                ),
                Slider(
                  value: _contentWidth,
                  min: _contentWidthMin,
                  max: _contentWidthMax,
                  divisions: ((_contentWidthMax - _contentWidthMin) / 20)
                      .round(),
                  label: '${_contentWidth.round()} px',
                  onChanged: _setContentWidth,
                ),

                const _GroupDivider(),

                // 体验
                const _SectionLabel('体验'),
                _SettingsRow(
                  title: '界面与动效',
                  subtitle: '按压、气泡、弹层与错误态',
                  onTap: () => context.push('/motion'),
                ),

                const _GroupDivider(),

                // 数据
                const _SectionLabel('数据'),
                _SettingsRow(
                  title: '导出加密备份',
                  subtitle: '生成 dream-export 文件',
                  onTap: _export,
                ),
                Divider(color: palette.border),
                _SettingsRow(
                  title: '导入分享',
                  subtitle: '从分享链接 / 分享 ID 导入',
                  onTap: _importShare,
                ),
                Divider(color: palette.border),
                _SettingsRow(
                  title: '导入归档',
                  subtitle: '从归档链接导入',
                  onTap: _importArchive,
                ),
                Divider(color: palette.border),
                _SettingsRow(
                  title: '导入 ZIP 归档',
                  subtitle: '从本地 .zip 文件导入',
                  onTap: _importArchiveZip,
                ),
                Divider(color: palette.border),
                _SettingsRow(
                  title: '导入备份文件',
                  subtitle: '从本地 .dream / .json / .gz 恢复',
                  onTap: _importBackupFile,
                ),
                Divider(color: palette.border),
                _SettingsRow(
                  title: '清空本地数据',
                  subtitle: '删除本机全部会话与消息',
                  onTap: _clearLocalData,
                ),

                const _GroupDivider(),

                // 账号
                const _SectionLabel('账号'),
                _SettingsRow(
                  title: '用户名',
                  trailing: Text(
                    widget.user?.username ?? '未登录',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: palette.textSecondary,
                    ),
                  ),
                ),
                if (widget.user?.customerNo != null) ...[
                  Divider(color: palette.border),
                  _SettingsRow(
                    title: '客户编号',
                    trailing: Text(
                      widget.user!.customerNo!,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: palette.textSecondary,
                      ),
                    ),
                  ),
                ],
                Divider(color: palette.border),
                _SettingsRow(title: '退出登录', onTap: _logout),

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
                _SettingsRow(title: '检查更新', onTap: _checkUpdate),
                Divider(color: palette.border),
                _SettingsRow(
                  title: '重构分支',
                  onTap: _copyBranch,
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

                const _GroupDivider(),

                // 反馈
                const _SectionLabel('反馈'),
                _SettingsRow(
                  title: '提交反馈',
                  subtitle: '描述问题与复现情况',
                  onTap: _feedback,
                ),

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
      ),
    );
  }
}

class _FeedbackDialog extends StatefulWidget {
  @override
  State<_FeedbackDialog> createState() => _FeedbackDialogState();
}

class _FeedbackDialogState extends State<_FeedbackDialog> {
  final _description = TextEditingController();
  String _reproducible = 'unknown';

  static const _reproducibleOptions = <(String, String)>[
    ('always', '总是复现'),
    ('sometimes', '偶尔复现'),
    ('once', '仅一次'),
    ('unknown', '不确定'),
  ];

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('提交反馈'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _description,
            autofocus: true,
            maxLines: 4,
            minLines: 2,
            maxLength: 4000,
            decoration: const InputDecoration(
              labelText: '问题描述',
              hintText: '请描述遇到的问题（5–4000 字）',
            ),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _reproducible,
            decoration: const InputDecoration(labelText: '复现情况'),
            items: [
              for (final (value, label) in _reproducibleOptions)
                DropdownMenuItem(value: value, child: Text(label)),
            ],
            onChanged: (v) {
              if (v != null) setState(() => _reproducible = v);
            },
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () {
            final description = _description.text.trim();
            if (description.length < 5) {
              ScaffoldMessenger.of(context)
                ..hideCurrentSnackBar()
                ..showSnackBar(const SnackBar(content: Text('问题描述至少 5 字')));
              return;
            }
            Navigator.pop(context, (description, _reproducible));
          },
          child: const Text('提交'),
        ),
      ],
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
