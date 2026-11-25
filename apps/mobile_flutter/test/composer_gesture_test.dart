import 'package:dream/design/dream_theme.dart';
import 'package:dream/features/chat/widgets/composer.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

Widget _host({
  required VoidCallback onStart,
  required ValueChanged<bool> onEnd,
}) {
  final controller = TextEditingController();
  final focus = FocusNode();
  return MaterialApp(
    theme: DreamTheme.dark(),
    home: Scaffold(
      body: Composer(
        controller: controller,
        focusNode: focus,
        canSend: false,
        onSend: (_) {},
        onAttach: () {},
        voiceEnabled: true,
        hintText: '轻点输入，长按说话',
        onVoiceStart: onStart,
        onVoiceEnd: onEnd,
      ),
    ),
  );
}

void main() {
  testWidgets('长按输入行开始语音，松手取消标记为 false', (tester) async {
    var started = 0;
    bool? endedCancel;
    await tester.pumpWidget(
      _host(onStart: () => started++, onEnd: (c) => endedCancel = c),
    );

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(TextField)),
    );
    await tester.pump(const Duration(milliseconds: 600));
    expect(started, 1);
    expect(find.text('正在聆听'), findsNothing);
    expect(find.textContaining('正在聆听'), findsOneWidget);

    await gesture.up();
    await tester.pumpAndSettle();
    expect(endedCancel, isFalse);
    expect(find.textContaining('正在聆听'), findsNothing);
  });

  testWidgets('长按后上滑超过阈值，松手取消标记为 true', (tester) async {
    var started = 0;
    bool? endedCancel;
    await tester.pumpWidget(
      _host(onStart: () => started++, onEnd: (c) => endedCancel = c),
    );

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(TextField)),
    );
    await tester.pump(const Duration(milliseconds: 600));
    expect(started, 1);

    await gesture.moveBy(const Offset(0, -90));
    await tester.pump();
    expect(find.text('松开取消'), findsOneWidget);

    await gesture.up();
    await tester.pumpAndSettle();
    expect(endedCancel, isTrue);
  });
}
