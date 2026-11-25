import 'package:dream/core/models.dart';
import 'package:dream/design/dream_theme.dart';
import 'package:dream/features/chat/widgets/day_divider.dart';
import 'package:dream/features/chat/widgets/message_list.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

Message _message(String id, DateTime at) => Message(
  id: id,
  conversationId: 'c1',
  role: ChatRole.assistant,
  content: '内容 $id',
  createdAt: at,
);

Widget _host(List<Message> messages) => MaterialApp(
  theme: DreamTheme.dark(),
  home: Scaffold(body: MessageList(messages: messages)),
);

void main() {
  group('dayAnchorLabel', () {
    final now = DateTime(2026, 11, 25, 15, 30);

    test('同一天显示「今天」', () {
      expect(dayAnchorLabel(DateTime(2026, 11, 25, 9), now: now), '今天');
    });

    test('前一天显示「昨天」（含当天 00:00）', () {
      expect(dayAnchorLabel(DateTime(2026, 11, 24, 23, 59), now: now), '昨天');
      expect(dayAnchorLabel(DateTime(2026, 11, 24), now: now), '昨天');
    });

    test('同年更早显示月日', () {
      expect(dayAnchorLabel(DateTime(2026, 1, 2, 8), now: now), '1月2日');
    });

    test('跨年补年份', () {
      expect(
        dayAnchorLabel(DateTime(2025, 12, 31, 23, 50), now: now),
        '2025年12月31日',
      );
    });

    test('未来日期按日期显示，不写「明天」', () {
      expect(dayAnchorLabel(DateTime(2027, 1, 1), now: now), '2027年1月1日');
    });
  });

  testWidgets('跨天插一条分隔，同日不插，首条不插', (tester) async {
    final messages = [
      _message('m1', DateTime(2001, 2, 3, 10)),
      _message('m2', DateTime(2001, 2, 3, 10, 5)),
      _message('m3', DateTime(2001, 2, 4, 9)),
    ];
    await tester.pumpWidget(_host(messages));

    // 首条（2001-02-03）上方没有分隔；跨天的 m3 上方有一条。
    expect(find.byType(DayDivider), findsOneWidget);
    expect(find.text('2001年2月4日'), findsOneWidget);
    expect(find.text('2001年2月3日'), findsNothing);
  });

  testWidgets('分隔不新增 ListView item，itemCount 仍等于消息数', (tester) async {
    final messages = [
      _message('m1', DateTime(2001, 2, 3, 10)),
      _message('m2', DateTime(2001, 2, 4, 10)),
      _message('m3', DateTime(2001, 2, 5, 10)),
    ];
    await tester.pumpWidget(_host(messages));

    final list = tester.widget<ListView>(find.byType(ListView));
    final delegate = list.childrenDelegate as SliverChildBuilderDelegate;
    expect(delegate.estimatedChildCount, messages.length);
  });

  testWidgets('单日会话零分隔', (tester) async {
    final messages = [
      _message('m1', DateTime(2001, 2, 3, 10)),
      _message('m2', DateTime(2001, 2, 3, 18)),
    ];
    await tester.pumpWidget(_host(messages));

    expect(find.byType(DayDivider), findsNothing);
  });
}
