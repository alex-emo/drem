// 设计实验台入口（不参与业务，仅用于在 Linux 桌面上真实渲染聊天界面，
// 供设计评审与截图核对）。运行：
//
//   flutter run -d linux -t lib/dev/design_preview.dart
//
// 数据全部来自本文件内的内存 fake，不联网、不读写真实会话、不需要登录。
import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../core/models.dart';
import '../design/dream_theme.dart';
import '../features/chat/chat_controller.dart';
import '../features/chat/presentation/chat_screen.dart';
import '../services/crypto_service.dart';
import '../services/session_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(await buildPreviewApp());
}

/// 供 `main()` 与截图测试共用的假数据控制器。
///
/// [fontFamily] 只在截图测试里用：Linux 桌面有系统字体，测试环境默认 Ahem。
Future<Widget> buildPreviewApp({
  String? fontFamily,
  ThemeMode themeMode = ThemeMode.dark,
}) async {
  final controller = ChatController(
    api: _PreviewApi(),
    repo: _PreviewStore(),
    crypto: const CryptoService(),
    session: _PreviewSession(),
  );
  await controller.load();
  await controller.openConversation('c1');
  ThemeData withFont(ThemeData theme) => fontFamily == null
      ? theme
      : theme.copyWith(textTheme: theme.textTheme.apply(fontFamily: fontFamily));
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Dream 设计实验台',
    theme: withFont(DreamTheme.light()),
    darkTheme: withFont(DreamTheme.dark()),
    themeMode: themeMode,
    home: ChatScreen(controller: controller),
  );
}

/// 不联网的流：只回一段固定文字，用来检查流式光标与自动滚动。
class _PreviewApi implements ChatApi {
  @override
  Future<Stream<Map<String, dynamic>>> chatStream(
    Map<String, dynamic> body, {
    void Function()? onCancel,
  }) async {
    const reply = '这是设计实验台的假回复，用来检查行高、与时间分隔的关系、以及气泡的最大宽度。';
    return Stream<Map<String, dynamic>>.fromIterable([
      {'type': 'start', 'model': 'dream-preview'},
      for (final rune in reply.runes)
        {'type': 'delta', 'delta': String.fromCharCode(rune)},
      {'type': 'done', 'finishReason': 'stop'},
    ]);
  }
}

class _PreviewSession extends SessionStore {
  @override
  Future<String?> getSessionKey() async => null;
}

class _PreviewStore implements ChatStore {
  final List<Conversation> _conversations = [];
  final Map<String, List<Message>> _messages = {};

  _PreviewStore() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day, 9, 12);
    final yesterday = today.subtract(const Duration(days: 1));
    final earlier = today.subtract(const Duration(days: 4));

    _conversations.addAll([
      Conversation(
        id: 'c1',
        title: '时间分隔与顶栏',
        createdAt: earlier,
        updatedAt: now,
      ),
      Conversation(
        id: 'c2',
        title: 'Flutter 重写 · 交互评审',
        createdAt: earlier,
        updatedAt: earlier,
      ),
    ]);

    _messages['c1'] = [
      Message(
        id: 'm1',
        conversationId: 'c1',
        role: ChatRole.user,
        content: '帮我看一下这版聊天气泡的行高，读长段落会不会太挤？',
        createdAt: earlier,
      ),
      Message(
        id: 'm2',
        conversationId: 'c1',
        role: ChatRole.assistant,
        content: '行高按 1.62 倍字号给的，正文 16.5 → 行高约 26.7。长段落每行约 34 个汉字，'
            '这个密度在手机上偏紧一点，但因为左右各留了 20pt，实际观感还行。\n\n'
            '真正要注意的是段间距和气泡内边距：如果只加行高不加段距，三段以上的回复会糊成一片。',
        createdAt: earlier.add(const Duration(minutes: 6)),
      ),
      Message(
        id: 'm3',
        conversationId: 'c1',
        role: ChatRole.user,
        content: '那时间分隔呢？跨天的时候会在哪出现？',
        createdAt: yesterday,
      ),
      Message(
        id: 'm4',
        conversationId: 'c1',
        role: ChatRole.assistant,
        content: '只在相邻两条消息的本地日期不同时插一条，首条上方不插，同一天不重复出现。',
        createdAt: yesterday.add(const Duration(minutes: 2)),
      ),
      Message(
        id: 'm5',
        conversationId: 'c1',
        role: ChatRole.user,
        content: '好，那今天这条应该出现在它上面。',
        createdAt: today,
      ),
      Message(
        id: 'm6',
        conversationId: 'c1',
        role: ChatRole.assistant,
        content: '对。分隔本身只有 12.5pt 的次要文字，没有背景、没有边框，也不占列表的 item。',
        createdAt: today.add(const Duration(minutes: 3)),
      ),
    ];
  }

  @override
  Future<List<Conversation>> listConversations() async =>
      List.of(_conversations);

  @override
  Future<Conversation?> getConversation(String id) async {
    for (final c in _conversations) {
      if (c.id == id) return c;
    }
    return null;
  }

  @override
  Future<void> putConversation(Conversation conversation) async {
    _conversations.removeWhere((c) => c.id == conversation.id);
    _conversations.add(conversation);
  }

  @override
  Future<void> deleteConversationData(String id) async {
    _conversations.removeWhere((c) => c.id == id);
    _messages.remove(id);
  }

  @override
  Future<List<Message>> getMessages(String conversationId) async =>
      List.of(_messages[conversationId] ?? const <Message>[]);

  @override
  Future<void> putMessage(Message message) async {
    final list = _messages.putIfAbsent(message.conversationId, () => []);
    list.removeWhere((m) => m.id == message.id);
    list.add(message);
  }

  @override
  Future<void> putMessages(List<Message> messages) async {
    for (final m in messages) {
      await putMessage(m);
    }
  }
}
