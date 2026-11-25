import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:material_ui/material_ui.dart';

import 'package:dream/features/chat/widgets/message_bubble.dart';
import 'package:dream/main.dart' as app;

/// 真机冒烟：真实登录 → 发一条消息 → 等流式结束。
/// 凭据通过 --dart-define 注入，禁止写进仓库。
Future<void> _pumpUntil(
  WidgetTester tester,
  bool Function() done, {
  Duration timeout = const Duration(seconds: 40),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 120));
    if (done()) return;
  }
  fail('等待超时');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const username = String.fromEnvironment('DREAM_TEST_USER');
  const password = String.fromEnvironment('DREAM_TEST_PASSWORD');

  testWidgets('登录并收到一条流式回复', (tester) async {
    expect(username, isNotEmpty, reason: '需要 --dart-define=DREAM_TEST_USER');
    expect(password, isNotEmpty, reason: '需要 --dart-define=DREAM_TEST_PASSWORD');

    app.main();
    await _pumpUntil(tester, () => find.byType(TextField).evaluate().length >= 2);

    await tester.enterText(find.byType(TextField).at(0), username);
    await tester.enterText(find.byType(TextField).at(1), password);
    await tester.tap(find.text('登录'));

    // 登录成功 → 聊天空态。
    await _pumpUntil(tester, () => find.textContaining('今天想问').evaluate().isNotEmpty);

    await tester.enterText(find.byType(TextField).last, '你好，用一句话介绍你自己。');
    await tester.tap(find.byTooltip('发送'));

    // 流式开始（出现「停止生成」）。
    await _pumpUntil(
      tester,
      () => find.text('停止生成').evaluate().isNotEmpty,
      timeout: const Duration(seconds: 30),
    );
    // 流式结束（「停止生成」消失）。
    await _pumpUntil(
      tester,
      () => find.text('停止生成').evaluate().isEmpty,
      timeout: const Duration(seconds: 90),
    );

    expect(find.byType(MessageBubble), findsAtLeastNWidgets(2));
    expect(find.textContaining('0x'), findsNothing);
  });
}
