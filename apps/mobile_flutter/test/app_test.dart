import 'package:dream/app/app.dart';
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

void main() {
  testWidgets('空态可选择建议并填入输入框', (tester) async {
    await pumpDreamApp(tester);

    expect(find.text('从一个问题开始。'), findsOneWidget);
    expect(find.text('写一段自我介绍'), findsOneWidget);

    await tester.tap(find.text('写一段自我介绍'));
    await tester.pumpAndSettle();

    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, contains('自我介绍'));
  });

  testWidgets('设置页可切换深色主题', (tester) async {
    await pumpDreamApp(tester);

    await tester.tap(find.byTooltip('设置'));
    await tester.pumpAndSettle();
    expect(find.byType(SettingsScreen), findsOneWidget);

    await tester.tap(find.text('深色'));
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(SettingsScreen));
    expect(Theme.of(context).brightness, Brightness.dark);
  });

  testWidgets('动效预览页可打开并展示错误态', (tester) async {
    await pumpDreamApp(tester);

    await tester.tap(find.byTooltip('设置'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('界面与动效'));
    await tester.pumpAndSettle();

    expect(find.text('动效预览'), findsOneWidget);
    expect(find.text('连接中断'), findsOneWidget);
  });
}
