import 'package:dream/design/dream_theme.dart';
import 'package:dream/features/chat/widgets/composer.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

Widget _host({
  required TextEditingController controller,
  required FocusNode focus,
  Future<bool> Function()? onStart,
  ValueChanged<bool>? onEnd,
  ValueChanged<String>? onSend,
  bool voiceEnabled = true,
  bool canSend = false,
}) {
  return MaterialApp(
    theme: DreamTheme.dark(),
    home: Scaffold(
      body: Composer(
        controller: controller,
        focusNode: focus,
        canSend: canSend,
        onSend: onSend ?? (_) {},
        onAttach: () {},
        voiceEnabled: voiceEnabled,
        onVoiceStart: onStart,
        onVoiceEnd: onEnd,
      ),
    ),
  );
}

void main() {
  testWidgets('麦克风常驻，发送键空输入时占位不可点', (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    var sent = 0;

    await tester.pumpWidget(
      _host(
        controller: controller,
        focus: focus,
        onSend: (_) => sent++,
      ),
    );
    await tester.pump();

    expect(find.byTooltip('语音输入'), findsOneWidget);
    // 发送键保留槽位（0006 §4.2），空输入时透明且忽略点击。
    expect(find.byTooltip('发送'), findsOneWidget);
    await tester.tap(find.byTooltip('发送'), warnIfMissed: false);
    await tester.pump();
    expect(sent, 0);

    controller.text = '写点东西';
    await tester.pump();
    // 有文字时麦克风仍在，不换位。
    expect(find.byTooltip('语音输入'), findsOneWidget);
    expect(find.byTooltip('发送'), findsOneWidget);
  });

  testWidgets('点麦克风进入录音，键盘焦点保持', (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    var started = 0;

    await tester.pumpWidget(
      _host(
        controller: controller,
        focus: focus,
        onStart: () async {
          started++;
          return true;
        },
      ),
    );
    focus.requestFocus();
    await tester.pump();

    await tester.tap(find.byTooltip('语音输入'));
    await tester.pumpAndSettle();

    expect(started, 1);
    expect(find.text('正在录音'), findsOneWidget);
    expect(find.text('0:00'), findsOneWidget);
    expect(find.byTooltip('停止录音'), findsOneWidget);
    expect(find.byTooltip('取消录音'), findsOneWidget);
    expect(focus.hasFocus, isTrue);
  });

  testWidgets('点停止结算为转写（cancel=false），不自动发送', (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    bool? endedCancel;
    var sent = 0;

    await tester.pumpWidget(
      _host(
        controller: controller,
        focus: focus,
        onStart: () async => true,
        onEnd: (cancel) => endedCancel = cancel,
        onSend: (_) => sent++,
      ),
    );

    await tester.tap(find.byTooltip('语音输入'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('停止录音'));
    await tester.pumpAndSettle();

    expect(endedCancel, isFalse);
    expect(sent, 0);
    expect(find.text('正在录音'), findsNothing);
  });

  testWidgets('点取消结算为丢弃（cancel=true），输入内容不变', (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    bool? endedCancel;

    await tester.pumpWidget(
      _host(
        controller: controller,
        focus: focus,
        onStart: () async => true,
        onEnd: (cancel) => endedCancel = cancel,
      ),
    );

    await tester.tap(find.byTooltip('语音输入'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('取消录音'));
    await tester.pumpAndSettle();

    expect(endedCancel, isTrue);
    expect(controller.text, isEmpty);
    expect(find.text('正在录音'), findsNothing);
  });

  testWidgets('录音到 60 秒上限自动停止并结算', (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    bool? endedCancel;

    await tester.pumpWidget(
      _host(
        controller: controller,
        focus: focus,
        onStart: () async => true,
        onEnd: (cancel) => endedCancel = cancel,
      ),
    );

    await tester.tap(find.byTooltip('语音输入'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 60));

    expect(endedCancel, isFalse);
    expect(find.text('正在录音'), findsNothing);
  });

  testWidgets('开始录音失败时不留假聆听态', (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);

    await tester.pumpWidget(
      _host(controller: controller, focus: focus, onStart: () async => false),
    );

    await tester.tap(find.byTooltip('语音输入'));
    await tester.pumpAndSettle();

    expect(find.text('正在录音'), findsNothing);
    expect(find.byTooltip('语音输入'), findsOneWidget);
  });

  testWidgets('语音不可用时只有发送按钮', (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);

    await tester.pumpWidget(
      _host(controller: controller, focus: focus, voiceEnabled: false),
    );
    await tester.pump();

    expect(find.byTooltip('语音输入'), findsNothing);
    expect(find.byTooltip('发送'), findsOneWidget);
  });
}
