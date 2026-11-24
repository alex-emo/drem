import 'package:material_ui/material_ui.dart';

import 'tokens.dart';

/// 主题扩展：放 ColorScheme 覆盖不到的 Dream 专用表面色。
@immutable
class DreamPalette extends ThemeExtension<DreamPalette> {
  const DreamPalette({
    required this.sidebar,
    required this.bubbleUser,
    required this.composer,
    required this.border,
    required this.borderStrong,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.brandSoft,
    required this.code,
  });

  final Color sidebar;
  final Color bubbleUser;
  final Color composer;
  final Color border;
  final Color borderStrong;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color brandSoft;
  final Color code;

  @override
  DreamPalette copyWith({
    Color? sidebar,
    Color? bubbleUser,
    Color? composer,
    Color? border,
    Color? borderStrong,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
    Color? brandSoft,
    Color? code,
  }) {
    return DreamPalette(
      sidebar: sidebar ?? this.sidebar,
      bubbleUser: bubbleUser ?? this.bubbleUser,
      composer: composer ?? this.composer,
      border: border ?? this.border,
      borderStrong: borderStrong ?? this.borderStrong,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textTertiary: textTertiary ?? this.textTertiary,
      brandSoft: brandSoft ?? this.brandSoft,
      code: code ?? this.code,
    );
  }

  @override
  DreamPalette lerp(ThemeExtension<DreamPalette>? other, double t) {
    if (other is! DreamPalette) {
      return this;
    }
    return DreamPalette(
      sidebar: Color.lerp(sidebar, other.sidebar, t)!,
      bubbleUser: Color.lerp(bubbleUser, other.bubbleUser, t)!,
      composer: Color.lerp(composer, other.composer, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderStrong: Color.lerp(borderStrong, other.borderStrong, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      brandSoft: Color.lerp(brandSoft, other.brandSoft, t)!,
      code: Color.lerp(code, other.code, t)!,
    );
  }
}

abstract final class DreamTheme {
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData light() => _build(Brightness.light);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final bg = isDark ? DreamColors.darkBg : DreamColors.lightBg;
    final brand = isDark ? DreamColors.brand : DreamColors.lightBrand;
    final brandStrong = isDark
        ? DreamColors.brandStrong
        : DreamColors.lightBrand;
    final textPrimary = isDark
        ? DreamColors.darkTextPrimary
        : DreamColors.lightTextPrimary;
    final textSecondary = isDark
        ? DreamColors.darkTextSecondary
        : DreamColors.lightTextSecondary;
    final textTertiary = isDark
        ? DreamColors.darkTextTertiary
        : DreamColors.lightTextTertiary;
    final border = isDark ? DreamColors.darkBorder : DreamColors.lightBorder;
    final borderStrong = isDark
        ? DreamColors.darkBorderStrong
        : DreamColors.lightBorderStrong;

    final palette = DreamPalette(
      sidebar: isDark ? DreamColors.darkSidebar : DreamColors.lightSidebar,
      bubbleUser: isDark ? const Color(0xFF1B2233) : const Color(0xFFEEF2FE),
      composer: isDark ? DreamColors.darkComposer : DreamColors.lightComposer,
      border: border,
      borderStrong: borderStrong,
      textPrimary: textPrimary,
      textSecondary: textSecondary,
      textTertiary: textTertiary,
      brandSoft: brand.withValues(alpha: isDark ? 0.16 : 0.09),
      code: isDark ? const Color(0xFF0F0F10) : const Color(0xFFF5F6F8),
    );

    final scheme =
        ColorScheme.fromSeed(seedColor: brand, brightness: brightness).copyWith(
          primary: brand,
          onPrimary: Colors.white,
          primaryContainer: palette.brandSoft,
          onPrimaryContainer: brandStrong,
          secondary: brand,
          onSecondary: Colors.white,
          secondaryContainer: palette.brandSoft,
          onSecondaryContainer: brandStrong,
          surface: bg,
          onSurface: textPrimary,
          onSurfaceVariant: textSecondary,
          surfaceContainerLowest: bg,
          surfaceContainerLow: isDark
              ? DreamColors.darkSidebar
              : DreamColors.lightSidebar,
          surfaceContainer: isDark
              ? const Color(0xFF232326)
              : const Color(0xFFF1F2F5),
          surfaceContainerHigh: isDark
              ? DreamColors.darkElevated
              : const Color(0xFFE9EBEF),
          surfaceContainerHighest: isDark
              ? const Color(0xFF35353A)
              : const Color(0xFFE1E3E8),
          outline: border,
          outlineVariant: border.withValues(alpha: 0.65),
          error: DreamColors.danger,
          onError: Colors.white,
        );

    final textTheme = const TextTheme(
      displaySmall: TextStyle(
        fontSize: 34,
        fontWeight: FontWeight.w600,
        height: 1.16,
        letterSpacing: -0.8,
      ),
      headlineMedium: TextStyle(
        fontSize: 26,
        fontWeight: FontWeight.w600,
        height: 1.22,
        letterSpacing: -0.4,
      ),
      headlineSmall: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        height: 1.25,
        letterSpacing: -0.2,
      ),
      titleLarge: TextStyle(
        fontSize: 19,
        fontWeight: FontWeight.w600,
        height: 1.3,
        letterSpacing: -0.2,
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        height: 1.4,
      ),
      bodyLarge: TextStyle(fontSize: 16, height: 1.55),
      bodyMedium: TextStyle(fontSize: 14, height: 1.5),
      bodySmall: TextStyle(fontSize: 12.5, height: 1.45),
      labelLarge: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w500,
        height: 1.3,
      ),
      labelMedium: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        height: 1.3,
      ),
    ).apply(bodyColor: textPrimary, displayColor: textPrimary);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      textTheme: textTheme,
      extensions: <ThemeExtension<dynamic>>[palette],
      visualDensity: VisualDensity.standard,
      splashFactory: InkRipple.splashFactory,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge?.copyWith(color: textPrimary),
        iconTheme: IconThemeData(color: textSecondary),
      ),
      iconTheme: IconThemeData(color: textSecondary, size: 22),
      dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isDark
            ? const Color(0xFF343438)
            : const Color(0xFF1F2023),
        contentTextStyle: textTheme.bodyMedium?.copyWith(color: Colors.white),
        insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DreamRadius.md),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: isDark ? DreamColors.darkElevated : Colors.white,
        modalBackgroundColor: isDark ? DreamColors.darkElevated : Colors.white,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(DreamRadius.xl),
          ),
        ),
      ),
    );
  }
}
