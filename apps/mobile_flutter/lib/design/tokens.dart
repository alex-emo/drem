import 'package:material_ui/material_ui.dart';

/// 8pt 网格。间距只用这里的 token，避免临时数值散落。
abstract final class DreamSpacing {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;

  /// 页面水平边距：紧凑屏 20，宽屏 28（对应 01 文档布局章节）。
  static const double pageMargin = 20;
  static const double pageMarginWide = 28;
}

abstract final class DreamRadius {
  static const double sm = 10;
  static const double md = 14;
  static const double lg = 20;
  static const double xl = 28;
  static const double pill = 999;
}

/// 动效基线：120–320ms，统一使用标准曲线；系统开启“减少动效”时全部降级为 0。
abstract final class DreamMotion {
  static const Duration press = Duration(milliseconds: 120);

  /// 按下要跟手、回弹要柔和：进入 90ms，恢复 180ms。
  static const Duration pressIn = Duration(milliseconds: 90);
  static const Duration pressOut = Duration(milliseconds: 180);
  static const Duration fast = Duration(milliseconds: 180);
  static const Duration page = Duration(milliseconds: 280);
  static const Duration pageOut = Duration(milliseconds: 220);
  static const Duration bubble = Duration(milliseconds: 260);
  static const Duration staggerStep = Duration(milliseconds: 45);
  static const Duration skeleton = Duration(milliseconds: 1200);
  static const Duration cursor = Duration(milliseconds: 600);
  static const Duration errorIn = Duration(milliseconds: 220);

  /// cubic-bezier(0.2, 0, 0, 1)
  static const Curve standard = Cubic(0.2, 0, 0, 1);
  static const Curve exit = Cubic(0.4, 0, 1, 1);
  static const Curve emphasized = Cubic(0.2, 0, 0, 1);
  static const Curve skeletonCurve = Curves.easeInOut;
}

/// 品牌蓝沿用 Dream 标识；表面色是 Flutter 端自有的一套，
/// 不复刻 web / DeepSeek 的逐像素视觉，只保持功能映射一致。
abstract final class DreamColors {
  static const Color brand = Color(0xFF5686FE);
  static const Color brandStrong = Color(0xFF6B95FF);
  static const Color lightBrand = Color(0xFF3964FE);
  static const Color danger = Color(0xFFE5645C);
  static const Color warning = Color(0xFFE2A03F);
  static const Color success = Color(0xFF4FB477);

  static const Color darkBg = Color(0xFF101012);
  static const Color darkSidebar = Color(0xFF161619);
  static const Color darkElevated = Color(0xFF1E1E22);
  static const Color darkComposer = Color(0xFF131315);
  static const Color darkBorder = Color(0xFF26262B);
  static const Color darkBorderStrong = Color(0xFF35353C);

  static const Color darkTextPrimary = Color(0xFFF4F4F5);
  static const Color darkTextSecondary = Color(0xFFB9BCC3);
  static const Color darkTextTertiary = Color(0xFF7F838C);

  static const Color lightBg = Color(0xFFFCFCFD);
  static const Color lightSidebar = Color(0xFFF5F5F7);
  static const Color lightElevated = Color(0xFFFFFFFF);
  static const Color lightComposer = Color(0xFFFFFFFF);
  static const Color lightBorder = Color(0xFFE7E7EC);
  static const Color lightBorderStrong = Color(0xFFD8D9E0);

  static const Color lightTextPrimary = Color(0xFF141416);
  static const Color lightTextSecondary = Color(0xFF575A61);
  static const Color lightTextTertiary = Color(0xFF6C7079);
}
