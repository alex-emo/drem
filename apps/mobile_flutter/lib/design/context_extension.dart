import 'package:material_ui/material_ui.dart';

import 'dream_theme.dart';

/// 便捷取色入口：feature 层直接 `context.dreamPalette`，无需手写
/// `Theme.of(context).extension<DreamPalette>()!`。
extension DreamContext on BuildContext {
  DreamPalette get dreamPalette => Theme.of(this).extension<DreamPalette>()!;
}
