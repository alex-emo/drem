import 'package:flutter/gestures.dart';
import 'package:material_ui/material_ui.dart';

/// 全局滚动参数：Flutter 3.50 的 [BouncingScrollPhysics] 已内置 iOS 同款
/// 惯性（`ScrollDecelerationRate.normal`）与橡皮筋回弹弹簧
/// （`BouncingScrollPhysics.rubberBandSpring`），不再手写 Simulation。
/// 依据：https://api.flutter.dev/flutter/widgets/BouncingScrollPhysics-class.html
const ScrollPhysics dreamScrollPhysics = BouncingScrollPhysics(
  parent: AlwaysScrollableScrollPhysics(),
  decelerationRate: ScrollDecelerationRate.normal,
);

/// 全局滚动行为：
/// - 内容再短也能拉动回弹（AlwaysScrollable）；
/// - 移动端不画滚动条；
/// - 触摸、触控笔、鼠标、触控板都可拖动。
class DreamScrollBehavior extends MaterialScrollBehavior {
  const DreamScrollBehavior();

  @override
  ScrollPhysics getScrollPhysics(BuildContext context) => dreamScrollPhysics;

  @override
  Widget buildScrollbar(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) {
    return child;
  }

  @override
  Set<PointerDeviceKind> get dragDevices => const {
    PointerDeviceKind.touch,
    PointerDeviceKind.stylus,
    PointerDeviceKind.invertedStylus,
    PointerDeviceKind.mouse,
    PointerDeviceKind.trackpad,
  };
}
