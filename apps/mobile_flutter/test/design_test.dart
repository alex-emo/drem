import 'package:dream/design/context_extension.dart';
import 'package:dream/design/dream_theme.dart';
import 'package:dream/design/tokens.dart';
import 'package:dream/shared/widgets/error_view.dart';
import 'package:dream/shared/widgets/pressable_scale.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

Widget _host({required Widget child, bool reduceMotion = false}) {
  final content = reduceMotion
      ? MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: child,
        )
      : child;
  return MaterialApp(
    theme: DreamTheme.light(),
    home: Scaffold(body: Center(child: content)),
  );
}

Finder _scaleOf() => find.descendant(
  of: find.byType(PressableScale),
  matching: find.byType(AnimatedScale),
);

/// 以 [theme] 构建最小 MaterialApp，settle 后从 Scaffold 上下文取 palette。
Future<DreamPalette> _paletteOf(WidgetTester tester, ThemeData theme) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: theme,
      home: const Scaffold(body: SizedBox.shrink()),
    ),
  );
  await tester.pumpAndSettle();
  return tester.element(find.byType(Scaffold)).dreamPalette;
}

void main() {
  test('DreamTheme 明暗两套非空且 scaffoldBackgroundColor 正确', () {
    final dark = DreamTheme.dark();
    final light = DreamTheme.light();

    expect(dark, isNotNull);
    expect(light, isNotNull);
    expect(dark.brightness, Brightness.dark);
    expect(light.brightness, Brightness.light);
    expect(dark.scaffoldBackgroundColor, DreamColors.darkBg);
    expect(light.scaffoldBackgroundColor, DreamColors.lightBg);
  });

  testWidgets(
    'DreamPalette 经 extension 与 Theme.extension 取到 bubbleUser/brandSoft',
    (tester) async {
      final darkPalette = await _paletteOf(tester, DreamTheme.dark());
      expect(darkPalette.bubbleUser, const Color(0xFF1B2233));
      expect(darkPalette.brandSoft, DreamColors.brand.withValues(alpha: 0.16));

      // 原始入口同样可达。
      final darkContext = tester.element(find.byType(Scaffold));
      final viaExtension = Theme.of(darkContext).extension<DreamPalette>();
      expect(viaExtension, isNotNull);
      expect(viaExtension!.bubbleUser, darkPalette.bubbleUser);
      expect(viaExtension.brandSoft, darkPalette.brandSoft);

      final lightPalette = await _paletteOf(tester, DreamTheme.light());
      expect(lightPalette.bubbleUser, const Color(0xFFEEF2FE));
      expect(
        lightPalette.brandSoft,
        DreamColors.lightBrand.withValues(alpha: 0.09),
      );
    },
  );

  testWidgets('PressableScale 在 disableAnimations 下仍可点击且缩放归 1', (tester) async {
    var tapped = false;
    await tester.pumpWidget(
      _host(
        reduceMotion: true,
        child: PressableScale(
          onTap: () => tapped = true,
          child: const SizedBox(width: 48, height: 48),
        ),
      ),
    );

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(PressableScale)),
    );
    await tester.pump();

    // 减少动效：scale 固定归 1，不加时长。
    expect(tester.widget<AnimatedScale>(_scaleOf()).scale, 1.0);

    await gesture.up();
    await tester.pump();
    expect(tapped, isTrue);
  });

  testWidgets('PressableScale 默认按压缩放为 pressedScale', (tester) async {
    await tester.pumpWidget(
      _host(
        child: PressableScale(
          onTap: () {},
          child: const SizedBox(width: 48, height: 48),
        ),
      ),
    );

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(PressableScale)),
    );
    await tester.pump();

    expect(tester.widget<AnimatedScale>(_scaleOf()).scale, 0.97);

    await gesture.up();
    await tester.pump();
  });

  testWidgets('ErrorView 显示文案并可触发重试回调', (tester) async {
    var retried = false;
    await tester.pumpWidget(
      _host(
        child: ErrorView(
          title: '连接中断',
          message: '请检查网络后重试',
          onRetry: () => retried = true,
        ),
      ),
    );

    expect(find.text('连接中断'), findsOneWidget);
    expect(find.text('请检查网络后重试'), findsOneWidget);

    // 语义标签：错误内容作为一个整体播报。
    expect(
      find.byWidgetPredicate(
        (w) => w is Semantics && w.properties.label == '连接中断。请检查网络后重试',
      ),
      findsOneWidget,
    );

    await tester.tap(find.text('重试'));
    await tester.pump();
    expect(retried, isTrue);
  });
}
