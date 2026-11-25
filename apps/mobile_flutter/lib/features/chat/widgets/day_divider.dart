import 'package:material_ui/material_ui.dart';

import '../../../design/context_extension.dart';
import '../../../design/tokens.dart';

/// 日期分隔的文案：本地时区，24 小时制，不带星期。
///
/// - 今天 → `今天`
/// - 昨天 → `昨天`
/// - 同年更早 → `11月20日`
/// - 跨年 → `2025年11月20日`
/// - 未来日期（时钟漂移）按同年/跨年规则显示，不写「明天」。
///
/// 抽成纯函数便于单测；组件只负责样式。
String dayAnchorLabel(DateTime date, {required DateTime now}) {
  final local = date.toLocal();
  final today = now.toLocal();
  final day = DateTime(local.year, local.month, local.day);
  final todayStart = DateTime(today.year, today.month, today.day);

  if (day == todayStart) return '今天';
  if (day == DateTime(today.year, today.month, today.day - 1)) return '昨天';
  if (local.year == today.year) return '${local.month}月${local.day}日';
  return '${local.year}年${local.month}月${local.day}日';
}

/// 跨天分隔：一行居中的小字，无背景无边框。
///
/// 结构靠留白，不靠线（Quiet Instrument）。读屏读「日期 + 文案」，
/// 不把分隔当成消息正文。
class DayDivider extends StatelessWidget {
  const DayDivider({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = context.dreamPalette;

    return Semantics(
      label: label,
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.only(
            top: DreamSpacing.pageMargin,
            bottom: DreamSpacing.sm,
          ),
          child: Center(
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: palette.textTertiary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
