import 'package:dream/design/dream_theme.dart';
import 'package:dream/features/chat/widgets/chat_header.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

/// 最小宿主：MaterialApp + 深色主题 + 带抽屉的 Scaffold。
///
/// 抽屉必须由 Scaffold 提供，`ChatHeader.onMenu` 才能调用 `openDrawer()`；
/// 因此这里用 Builder 拿到 Scaffold 下方的 context。
Widget host({
  bool withMenu = true,
  VoidCallback? onNewChat,
  VoidCallback? onSettings,
}) {
  return MaterialApp(
    theme: DreamTheme.dark(),
    home: Scaffold(
      drawer: const Drawer(child: Text('抽屉内容')),
      body: Builder(
        builder: (context) => ChatHeader(
          onMenu: withMenu ? () => Scaffold.of(context).openDrawer() : null,
          onNewChat: onNewChat,
          onSettings: onSettings,
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('有控制器时：菜单与「新对话」可见，品牌不可点', (tester) async {
    await tester.pumpWidget(host(onNewChat: () {}));

    expect(find.byTooltip('会话'), findsOneWidget);
    expect(find.byTooltip('新对话'), findsOneWidget);
    expect(find.text('Dream'), findsOneWidget);

    // 旧版顶栏的不可点灰字不应再出现。
    expect(find.text('左滑会话'), findsNothing);
    expect(find.text('左滑看会话 · 长按说话'), findsNothing);
  });

  testWidgets('点菜单按钮打开会话抽屉', (tester) async {
    await tester.pumpWidget(host(onNewChat: () {}));

    expect(find.text('抽屉内容'), findsNothing);
    await tester.tap(find.byTooltip('会话'));
    await tester.pumpAndSettle();

    expect(find.text('抽屉内容'), findsOneWidget);
  });

  testWidgets('点「新对话」触发回调，不打开抽屉', (tester) async {
    var created = 0;
    await tester.pumpWidget(host(onNewChat: () => created++));

    await tester.tap(find.byTooltip('新对话'));
    await tester.pumpAndSettle();

    expect(created, 1);
    expect(find.text('抽屉内容'), findsNothing);
  });

  testWidgets('P0 骨架没有控制器时：只有设置入口', (tester) async {
    var settings = 0;
    await tester.pumpWidget(
      host(withMenu: false, onSettings: () => settings++),
    );

    expect(find.byTooltip('会话'), findsNothing);
    expect(find.byTooltip('新对话'), findsNothing);
    expect(find.byTooltip('设置'), findsOneWidget);

    await tester.tap(find.byTooltip('设置'));
    await tester.pumpAndSettle();
    expect(settings, 1);
  });

  testWidgets('左缘右滑仍可打开抽屉（手势作为加速器保留）', (tester) async {
    await tester.pumpWidget(host(onNewChat: () {}));

    expect(find.text('抽屉内容'), findsNothing);
    await tester.dragFrom(const Offset(2, 300), const Offset(320, 0));
    await tester.pumpAndSettle();

    expect(find.text('抽屉内容'), findsOneWidget);
  });
}
