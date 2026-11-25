import 'package:dream/app/app.dart';
import 'package:dream/app/theme_controller.dart';
import 'package:dream/features/motion/presentation/motion_lab_screen.dart';
import 'package:dream/features/settings/presentation/settings_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> pumpDreamApp(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({});
  final preferences = await SharedPreferences.getInstance();
  await tester.pumpWidget(DreamApp(preferences: preferences));
  await tester.pumpAndSettle();
}

ThemeController settingsController(WidgetTester tester) =>
    ThemeScope.of(tester.element(find.byType(SettingsScreen)));

Future<void> openSettings(WidgetTester tester) async {
  await tester.tap(find.byTooltip('设置'));
  await tester.pumpAndSettle();
  expect(find.byType(SettingsScreen), findsOneWidget);
}

Future<void> openMotionLab(WidgetTester tester) async {
  await tester.tap(find.text('界面与动效'));
  await tester.pumpAndSettle();
  expect(find.byType(MotionLabScreen), findsOneWidget);
}

void main() {
  testWidgets('设置页三档主题点击后 ThemeController 值变化', (tester) async {
    await pumpDreamApp(tester);
    await openSettings(tester);

    // 初始为 system（mock preferences 为空）。
    expect(settingsController(tester).mode, ThemeMode.system);

    await tester.tap(find.text('深色'));
    await tester.pumpAndSettle();
    expect(settingsController(tester).mode, ThemeMode.dark);

    await tester.tap(find.text('浅色'));
    await tester.pumpAndSettle();
    expect(settingsController(tester).mode, ThemeMode.light);

    await tester.tap(find.text('系统'));
    await tester.pumpAndSettle();
    expect(settingsController(tester).mode, ThemeMode.system);
  });

  testWidgets('关于区显示版本与重构分支', (tester) async {
    await pumpDreamApp(tester);
    await openSettings(tester);

    expect(find.text('1.7.12 (35)'), findsOneWidget);
    expect(find.text('feat/flutter-mobile-rewrite'), findsOneWidget);
  });

  testWidgets('动效页减少动效开关开启后仍可交互不崩', (tester) async {
    await pumpDreamApp(tester);
    await openSettings(tester);
    await openMotionLab(tester);

    // 页面唯一 Switch 是“减少动效”。
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    // 关闭动效后仍可打开弹层并关闭（弹层按钮『知道了』随弹层出现/消失）。
    await tester.tap(find.text('打开弹层'));
    await tester.pumpAndSettle();
    expect(find.text('知道了'), findsOneWidget);

    await tester.tap(find.text('知道了'));
    await tester.pumpAndSettle();
    expect(find.text('知道了'), findsNothing);
  });

  testWidgets('设置页返回可达', (tester) async {
    await pumpDreamApp(tester);
    await openSettings(tester);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    expect(find.byType(SettingsScreen), findsNothing);
  });
}
