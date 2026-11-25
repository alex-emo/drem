import 'package:dream/design/dream_theme.dart';
import 'package:dream/features/chat/widgets/composer.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

Widget _host({
  required Future<bool> Function() onStart,
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
      _host(
        onStart: () async {
          started++;
          return true;
        },
        onEnd: (c) => endedCancel = c,
      ),
    );

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(TextField)),
    );
    await tester.pump(const Duration(milliseconds: 600));
    expect(started, 1);
    expect(find.text('正在录音'), findsNothing);
    expect(find.textContaining('正在录音'), findsOneWidget);
    // 长按态也有可见退路（0006）：第二根手指可点取消/停止。
    expect(find.byTooltip('停止录音'), findsOneWidget);
    expect(find.byTooltip('取消录音'), findsOneWidget);

    await gesture.up();
    await tester.pumpAndSettle();
    expect(endedCancel, isFalse);
    expect(find.textContaining('正在录音'), findsNothing);
  });

  testWidgets('长按后上滑超过阈值，松手取消标记为 true', (tester) async {
    var started = 0;
    bool? endedCancel;
    await tester.pumpWidget(
      _host(
        onStart: () async {
          started++;
          return true;
        },
        onEnd: (c) => endedCancel = c,
      ),
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

  testWidgets('输入框已聚焦时长按不进入语音（选字优先）', (tester) async {
    var started = 0;
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);

    await tester.pumpWidget(
      MaterialApp(
        theme: DreamTheme.dark(),
        home: Scaffold(
          body: Composer(
            controller: controller,
            focusNode: focus,
            canSend: false,
            onSend: (_) {},
            onAttach: () {},
            voiceEnabled: true,
            onVoiceStart: () async {
              started++;
              return true;
            },
            onVoiceEnd: (_) {},
          ),
        ),
      ),
    );

    await tester.tap(find.byType(TextField));
    await tester.pump();
    expect(focus.hasFocus, isTrue);
    expect(
      tester
          .widget<TextField>(find.byType(TextField))
          .enableInteractiveSelection,
      isTrue,
    );

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(TextField)),
    );
    await tester.pump(const Duration(milliseconds: 600));
    expect(started, 0);
    expect(find.textContaining('正在录音'), findsNothing);

    await gesture.up();
    await tester.pumpAndSettle();
  });

  testWidgets('按住发送按钮不进入语音', (tester) async {
    var started = 0;
    final controller = TextEditingController(text: 'x');
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);

    await tester.pumpWidget(
      MaterialApp(
        theme: DreamTheme.dark(),
        home: Scaffold(
          body: Composer(
            controller: controller,
            focusNode: focus,
            canSend: true,
            onSend: (_) {},
            onAttach: () {},
            voiceEnabled: true,
            onVoiceStart: () async {
              started++;
              return true;
            },
            onVoiceEnd: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();

    final send = find.widgetWithIcon(IconButton, Icons.arrow_upward_rounded);
    final gesture = await tester.startGesture(tester.getCenter(send));
    await tester.pump(const Duration(milliseconds: 600));
    expect(started, 0);

    await gesture.up();
    await tester.pumpAndSettle();
  });
}
