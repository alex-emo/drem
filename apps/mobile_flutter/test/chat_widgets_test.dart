import 'package:dream/core/models.dart';
import 'package:dream/design/dream_theme.dart';
import 'package:dream/features/chat/widgets/composer.dart';
import 'package:dream/features/chat/widgets/message_bubble.dart';
import 'package:dream/features/chat/widgets/message_list.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

/// 最小宿主：包一层 Dream 深色主题 + Scaffold，提供 Theme/Material 上下文。
Widget wrap(Widget child) {
  return MaterialApp(
    theme: DreamTheme.dark(),
    home: Scaffold(body: child),
  );
}

/// Composer 宿主：持有 controller/focusNode，canSend 由文本内容派生并随输入重建。
class _ComposerHarness extends StatefulWidget {
  const _ComposerHarness({this.onSend, this.onAttach});

  final ValueChanged<String>? onSend;
  final VoidCallback? onAttach;

  @override
  State<_ComposerHarness> createState() => _ComposerHarnessState();
}

class _ComposerHarnessState extends State<_ComposerHarness> {
  final controller = TextEditingController();
  final focusNode = FocusNode();

  bool get canSend => controller.text.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    controller.addListener(_onTextChanged);
  }

  void _onTextChanged() => setState(() {});

  @override
  void dispose() {
    controller.dispose();
    focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Composer(
      controller: controller,
      focusNode: focusNode,
      canSend: canSend,
      onSend: (text) => widget.onSend?.call(text),
      onAttach: () => widget.onAttach?.call(),
    );
  }
}

void main() {
  setUp(() {
    // 让 HapticFeedback 等平台通道调用在测试中静默成功。
    TestWidgetsFlutterBinding.ensureInitialized();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (_) async => null);
  });

  Finder sendButton() =>
      find.widgetWithIcon(IconButton, Icons.arrow_upward_rounded);
  Finder attachButton() => find.widgetWithIcon(IconButton, Icons.add_rounded);

  group('Composer', () {
    testWidgets('(a) 空输入禁用发送，输入后启用', (tester) async {
      await tester.pumpWidget(wrap(const _ComposerHarness()));

      // 初始 canSend=false → 发送按钮 onPressed 为 null（禁用）。
      expect(tester.widget<IconButton>(sendButton()).onPressed, isNull);

      await tester.enterText(find.byType(TextField), 'hi');
      await tester.pump();

      expect(tester.widget<IconButton>(sendButton()).onPressed, isNotNull);
    });

    testWidgets('(b) 多行输入框配置为 1→5 行上限', (tester) async {
      await tester.pumpWidget(wrap(const _ComposerHarness()));

      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.minLines, 1);
      expect(field.maxLines, 5);
      expect(field.keyboardType, TextInputType.multiline);
      expect(field.textInputAction, TextInputAction.newline);
    });

    testWidgets('(c) onSend 收到文本且发送后清空', (tester) async {
      String? sent;
      await tester.pumpWidget(wrap(_ComposerHarness(onSend: (t) => sent = t)));

      await tester.enterText(find.byType(TextField), 'hello');
      await tester.pump();

      await tester.tap(sendButton());
      await tester.pump();

      expect(sent, 'hello');
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.controller!.text, isEmpty);
    });

    testWidgets('附件按钮触发 onAttach', (tester) async {
      var attached = 0;
      await tester.pumpWidget(
        wrap(_ComposerHarness(onAttach: () => attached++)),
      );

      await tester.tap(attachButton());
      await tester.pump();

      expect(attached, 1);
    });
  });

  group('MessageBubble', () {
    testWidgets('(d1) 用户/助手渲染不同（对齐与气泡底）', (tester) async {
      await tester.pumpWidget(
        wrap(
          const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              MessageBubble(text: 'hi', isUser: true),
              MessageBubble(text: 'hi2', isUser: false),
            ],
          ),
        ),
      );

      final palette = Theme.of(tester.element(find.byType(MessageBubble).first))
          .extension<DreamPalette>()!;

      // 用户：右对齐 + bubbleUser 底色气泡。
      final userAlign = tester.widget<Align>(
        find.ancestor(of: find.text('hi'), matching: find.byType(Align)).first,
      );
      expect(userAlign.alignment, Alignment.centerRight);
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Container &&
              w.decoration is BoxDecoration &&
              (w.decoration as BoxDecoration).color == palette.bubbleUser,
        ),
        findsOneWidget,
      );

      // 助手：左对齐、无气泡底（上面的 bubbleUser 断言 findsOneWidget 已排除助手）。
      final assistantAlign = tester.widget<Align>(
        find.ancestor(of: find.text('hi2'), matching: find.byType(Align)).first,
      );
      expect(assistantAlign.alignment, Alignment.centerLeft);
    });

    testWidgets('(d2) isStreaming 显示 1.5pt 呼吸光标', (tester) async {
      await tester.pumpWidget(
        wrap(
          const MessageBubble(
            text: 'thinking',
            isUser: false,
            isStreaming: true,
          ),
        ),
      );

      // 无限动画：只用 pump，禁用 pumpAndSettle。
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('thinking'), findsOneWidget);

      final cursor = find.byWidgetPredicate(
        (w) =>
            w is Container &&
            w.constraints != null &&
            w.constraints!.minWidth == 1.5 &&
            w.constraints!.maxWidth == 1.5,
      );
      expect(cursor, findsOneWidget);

      // 光标为 brand 竖条。
      final cursorContainer = tester.widget<Container>(cursor);
      final deco = cursorContainer.decoration! as BoxDecoration;
      expect(deco.color, Theme.of(tester.element(cursor)).colorScheme.primary);
    });

    testWidgets('(d3) isError 显示错误横幅并可触发重试回调', (tester) async {
      var retried = 0;
      await tester.pumpWidget(
        wrap(
          MessageBubble(
            text: 'boom',
            isUser: true,
            errorText: '发送失败',
            onRetry: () => retried++,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('boom'), findsOneWidget);
      expect(find.text('发送失败'), findsOneWidget);

      await tester.tap(find.text('重试'));
      await tester.pump();
      expect(retried, 1);
    });
  });

  group('MessageList', () {
    testWidgets('(e1) 空 + empty 渲染 empty', (tester) async {
      await tester.pumpWidget(
        wrap(const MessageList(messages: [], empty: Text('暂无消息'))),
      );
      expect(find.text('暂无消息'), findsOneWidget);
      expect(find.byType(ListView), findsNothing);
    });

    testWidgets('(e2) 无 empty 不崩', (tester) async {
      await tester.pumpWidget(wrap(const MessageList(messages: [])));
      expect(find.byType(ListView), findsOneWidget);
    });

    testWidgets('有消息时渲染气泡', (tester) async {
      final messages = [
        Message(
          id: '1',
          conversationId: 'c1',
          role: ChatRole.user,
          content: '你好',
          createdAt: DateTime(2025, 1, 1),
        ),
        Message(
          id: '2',
          conversationId: 'c1',
          role: ChatRole.assistant,
          content: '嗨',
          createdAt: DateTime(2025, 1, 1, 0, 0, 1),
        ),
      ];
      await tester.pumpWidget(wrap(MessageList(messages: messages)));
      expect(find.text('你好'), findsOneWidget);
      expect(find.text('嗨'), findsOneWidget);
    });
  });
}
