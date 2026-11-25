import 'package:material_ui/material_ui.dart';

import '../../../design/context_extension.dart';
import '../../../design/tokens.dart';
import '../../../shared/widgets/dream_mark.dart';

/// 聊天页顶栏：品牌 + 最多两个入口。
///
/// 契约（见 `docs/design/components/chat-shell.md`）：
/// - 左：会话抽屉把手（导航）。没有控制器时不显示。
/// - 中：DreamMark + 「Dream」，不可点。
/// - 右：新对话（动作）；P0 骨架没有控制器时退化为设置入口。
///
/// 高度固定 56pt（48 行 + 上下各 4），避免出现/消失时顶动内容。
/// 所有按钮 44×44，图标 20px，颜色 textSecondary。
class ChatHeader extends StatelessWidget {
  const ChatHeader({super.key, this.onMenu, this.onNewChat, this.onSettings});

  /// 打开会话抽屉。为 null 时不显示把手（P0 骨架）。
  final VoidCallback? onMenu;

  /// 新建对话。为 null 时隐藏。
  final VoidCallback? onNewChat;

  /// 设置入口。仅在没有控制器（P0 骨架）时使用。
  final VoidCallback? onSettings;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = context.dreamPalette;

    final VoidCallback? menu = onMenu;
    final VoidCallback? trailing = onNewChat ?? onSettings;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: DreamSpacing.pageMargin,
        vertical: DreamSpacing.xxs,
      ),
      child: SizedBox(
        height: 48,
        child: Row(
          children: [
            if (menu != null) ...[
              _HeaderAction(
                icon: Icons.menu_rounded,
                tooltip: '会话',
                onPressed: menu,
              ),
              const SizedBox(width: DreamSpacing.xxs),
            ],
            const DreamMark(size: 22),
            const SizedBox(width: DreamSpacing.xs),
            Text(
              'Dream',
              style: theme.textTheme.titleMedium?.copyWith(
                color: palette.textPrimary,
              ),
            ),
            const Spacer(),
            if (trailing != null)
              _HeaderAction(
                icon: onNewChat != null
                    ? Icons.add_comment_outlined
                    : Icons.tune_rounded,
                tooltip: onNewChat != null ? '新对话' : '设置',
                onPressed: trailing,
              ),
          ],
        ),
      ),
    );
  }
}

/// 44×44 的顶栏图标按钮：统一尺寸、颜色与点击反馈。
class _HeaderAction extends StatelessWidget {
  const _HeaderAction({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final palette = context.dreamPalette;
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      icon: Icon(icon, size: 20, color: palette.textSecondary),
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints.tightFor(width: 44, height: 44),
      splashRadius: 22,
      visualDensity: VisualDensity.compact,
    );
  }
}
