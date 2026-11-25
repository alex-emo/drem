import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dream/core/errors.dart';
import 'package:dream/core/history.dart';
import 'package:dream/core/models.dart';
import 'package:dream/features/chat/chat_controller.dart';
import 'package:dream/services/crypto_service.dart';
import 'package:dream/services/session_store.dart';

/// 内存版 ChatApi：每次 chatStream 记录请求体，并返回一个可手动驱动的流。
class FakeChatApi implements ChatApi {
  final List<Map<String, dynamic>> bodies = <Map<String, dynamic>>[];
  final List<StreamController<Map<String, dynamic>>> controllers =
      <StreamController<Map<String, dynamic>>>[];

  @override
  Future<Stream<Map<String, dynamic>>> chatStream(
    Map<String, dynamic> body, {
    void Function()? onCancel,
  }) async {
    bodies.add(body);
    final sc = StreamController<Map<String, dynamic>>();
    controllers.add(sc);
    return sc.stream;
  }

  StreamController<Map<String, dynamic>> get last => controllers.last;
}

/// 内存版 ChatStore：镜像 ChatRepository 的聊天接口。
class FakeChatStore implements ChatStore {
  final Map<String, Conversation> conversations = <String, Conversation>{};
  final Map<String, List<Message>> messages = <String, List<Message>>{};
  final List<String> tombstones = <String>[];

  @override
  Future<List<Conversation>> listConversations() async {
    final list = conversations.values.toList();
    list.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return list;
  }

  @override
  Future<Conversation?> getConversation(String id) async => conversations[id];

  @override
  Future<void> putConversation(Conversation conversation) async {
    conversations[conversation.id] = conversation;
  }

  @override
  Future<void> deleteConversationData(String id) async {
    conversations.remove(id);
    messages.remove(id);
    tombstones.add(id);
  }

  @override
  Future<List<Message>> getMessages(String conversationId) async =>
      List<Message>.of(messages[conversationId] ?? const <Message>[]);

  @override
  Future<void> putMessage(Message message) async {
    final list = messages.putIfAbsent(
      message.conversationId,
      () => <Message>[],
    );
    final idx = list.indexWhere((m) => m.id == message.id);
    if (idx >= 0) {
      list[idx] = message;
    } else {
      list.add(message);
    }
  }

  @override
  Future<void> putMessages(List<Message> msgs) async {
    for (final m in msgs) {
      await putMessage(m);
    }
  }
}

/// 无密钥的 SessionStore（明文存储，避免平台加密存储依赖）。
class FakeSessionStore extends SessionStore {
  FakeSessionStore({this.key});

  final String? key;

  @override
  Future<String?> getSessionKey() async => key;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  FakeChatApi newApi() => FakeChatApi();
  FakeChatStore newStore() => FakeChatStore();

  ChatController newController(
    FakeChatApi api,
    FakeChatStore store, {
    String? sessionKey,
  }) {
    return ChatController(
      api: api,
      repo: store,
      crypto: const CryptoService(),
      session: FakeSessionStore(key: sessionKey),
    );
  }

  /// 等待一次流式回复跑完（start/delta/done），返回 controller 以便继续断言。
  Future<void> driveReply(
    FakeChatApi api,
    Future<void> future, {
    String content = '回复',
    List<String> thinkingDeltas = const <String>[],
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 10));
    final sc = api.last;
    sc.add(<String, dynamic>{'type': 'start', 'thinking': true});
    for (final d in thinkingDeltas) {
      sc.add(<String, dynamic>{'type': 'thinking', 'delta': d});
    }
    if (content.isNotEmpty) {
      sc.add(<String, dynamic>{'type': 'delta', 'delta': content});
    }
    sc.add(<String, dynamic>{
      'type': 'done',
      'finishReason': 'stop',
      'requestId': 'r1',
    });
    await sc.close();
    await future;
  }

  group('sendMessage', () {
    test('建树：user.parentId=null，assistant.parentId=user.id，selectedChildId 指向新 assistant', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final future = chat.sendMessage('你好');
      await driveReply(api, future);

      expect(chat.allMessages.length, 2);
      final user = chat.allMessages.firstWhere((m) => m.role == ChatRole.user);
      final assistant = chat.allMessages.firstWhere(
        (m) => m.role == ChatRole.assistant,
      );
      expect(user.parentId, isNull);
      expect(assistant.parentId, user.id);
      expect(user.selectedChildId, assistant.id);

      // 默认关闭深度思考，避免每条消息都走推理模型。
      expect(api.bodies.single['thinking'], isFalse);
      expect(chat.deepThinking, isFalse);
      expect(api.bodies.single['messages'], <Map<String, String>>[
        <String, String>{'role': 'user', 'content': '你好'},
      ]);

      // 会话已建且标题为 makeTitle 结果。
      expect(chat.activeConversation, isNotNull);
      expect(chat.activeConversation!.title, '你好');
    });

    test('追加消息：user.parentId=可见末条，父 selectedChildId 改指新 user', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final f1 = chat.sendMessage('第一问');
      await driveReply(api, f1);
      final firstAssistant = chat.allMessages.firstWhere(
        (m) => m.role == ChatRole.assistant,
      );

      final f2 = chat.sendMessage('第二问');
      await driveReply(api, f2);

      final users = chat.allMessages
          .where((m) => m.role == ChatRole.user)
          .toList();
      expect(users.length, 2);
      final secondUser = users[1];
      expect(secondUser.parentId, firstAssistant.id);

      // 第一个 assistant 的 selectedChildId 应改指第二个 user。
      final firstAssistantUpdated = chat.allMessages.firstWhere(
        (m) => m.id == firstAssistant.id,
      );
      expect(firstAssistantUpdated.selectedChildId, secondUser.id);

      // 请求体应含历史 + 新 user。
      expect(api.bodies.last['messages'], <Map<String, String>>[
        <String, String>{'role': 'user', 'content': '第一问'},
        <String, String>{'role': 'assistant', 'content': '回复'},
        <String, String>{'role': 'user', 'content': '第二问'},
      ]);
    });

    test('streaming→done：reasoning 累积、content 累积、status 持久化为 done', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final future = chat.sendMessage('问题');
      await driveReply(
        api,
        future,
        content: '答案',
        thinkingDeltas: <String>['思', '考'],
      );

      final assistant = chat.allMessages.firstWhere(
        (m) => m.role == ChatRole.assistant,
      );
      expect(assistant.status, MessageStatus.done);
      expect(assistant.content, '答案');
      expect(assistant.reasoning, '思考');
      expect(chat.streaming, isFalse);
      expect(chat.thinking, isFalse);

      // 持久化：store 里 assistant 也是 done。
      final stored = store.messages[chat.activeConversation!.id]!;
      final storedAssistant = stored.firstWhere(
        (m) => m.role == ChatRole.assistant,
      );
      expect(storedAssistant.status, MessageStatus.done);
      expect(storedAssistant.content, '答案');
    });

    test('stop：pending 结算、status=stopped、streaming 复位', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final future = chat.sendMessage('问题');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      final sc = api.last;
      sc.add(<String, dynamic>{'type': 'start', 'thinking': false});
      sc.add(<String, dynamic>{'type': 'delta', 'delta': '还没说完'});
      // 等 delta 事件被监听器消费（进入 pending）。
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(chat.streaming, isTrue);
      chat.stop();
      await future;

      final assistant = chat.allMessages.firstWhere(
        (m) => m.role == ChatRole.assistant,
      );
      expect(assistant.status, MessageStatus.stopped);
      expect(assistant.content, '还没说完');
      expect(chat.streaming, isFalse);
    });
  });

  group('editMessage / regenerate / selectMessageVersion', () {
    test('editMessage：编辑首条换根，新建 user+assistant 复用 parentId', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final f1 = chat.sendMessage('原问题');
      await driveReply(api, f1);
      final user = chat.allMessages.firstWhere((m) => m.role == ChatRole.user);

      final f2 = chat.editMessage(user.id, '改后问题');
      await driveReply(api, f2, content: '新答案');

      final users = chat.allMessages
          .where((m) => m.role == ChatRole.user)
          .toList();
      expect(users.length, 2);
      final newUser = users.last;
      // 编辑首条（parentId 为 null）→ 新 user parentId 仍 null。
      expect(newUser.parentId, isNull);
      expect(newUser.content, '改后问题');
      // 新 assistant 挂在 newUser 下。
      final assistants = chat.allMessages
          .where((m) => m.role == ChatRole.assistant)
          .toList();
      expect(assistants.length, 2);
      final newAssistant = assistants.last;
      expect(newAssistant.parentId, newUser.id);
      expect(newUser.selectedChildId, newAssistant.id);

      // 换根：会话 rootMessageId 指向新 user。
      expect(chat.activeConversation!.rootMessageId, newUser.id);
    });

    test('regenerate：target 须 assistant 且有 parentId，question.selectedChildId 改指新 assistant', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final f1 = chat.sendMessage('问题');
      await driveReply(api, f1);
      final oldAssistant = chat.allMessages.firstWhere(
        (m) => m.role == ChatRole.assistant,
      );

      final f2 = chat.regenerate(oldAssistant.id);
      await driveReply(api, f2, content: '第二个答案');

      final assistants = chat.allMessages
          .where((m) => m.role == ChatRole.assistant)
          .toList();
      expect(assistants.length, 2);
      final newAssistant = assistants.last;
      expect(newAssistant.parentId, oldAssistant.parentId);

      final question = chat.allMessages.firstWhere(
        (m) => m.id == oldAssistant.parentId,
      );
      expect(question.selectedChildId, newAssistant.id);

      // 重新生成无需新 user，请求体末尾是 question。
      final lastBodyMessages = api.bodies.last['messages'] as List<dynamic>;
      expect(lastBodyMessages.last, <String, String>{
        'role': 'user',
        'content': '问题',
      });
    });

    test('selectMessageVersion：切到旧 assistant 版本', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final f1 = chat.sendMessage('问题');
      await driveReply(api, f1);
      final oldAssistant = chat.allMessages.firstWhere(
        (m) => m.role == ChatRole.assistant,
      );

      final f2 = chat.regenerate(oldAssistant.id);
      await driveReply(api, f2, content: '第二个答案');

      await chat.selectMessageVersion(oldAssistant.id);

      final question = chat.allMessages.firstWhere(
        (m) => m.id == oldAssistant.parentId,
      );
      expect(question.selectedChildId, oldAssistant.id);
    });
  });

  group('removeConversation', () {
    test('写 tombstone 并清空 activeId / allMessages', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final future = chat.sendMessage('问题');
      await driveReply(api, future);
      final cid = chat.activeConversation!.id;

      await chat.removeConversation(cid);

      expect(store.tombstones, contains(cid));
      expect(store.conversations.containsKey(cid), isFalse);
      expect(store.messages.containsKey(cid), isFalse);
      expect(chat.activeId, isNull);
      expect(chat.allMessages, isEmpty);
      expect(chat.conversations, isEmpty);
    });
  });

  group('historyFor', () {
    test('过滤 excludeFromContext 与空 content 的 assistant，user 全保留', () {
      final now = DateTime(2025, 1, 1);
      final msgs = <Message>[
        Message(
          id: 'u1',
          conversationId: 'c',
          role: ChatRole.user,
          content: 'q1',
          createdAt: now,
        ),
        Message(
          id: 'a1',
          conversationId: 'c',
          role: ChatRole.assistant,
          content: 'a1',
          excludeFromContext: true,
          createdAt: now,
        ),
        Message(
          id: 'u2',
          conversationId: 'c',
          role: ChatRole.user,
          content: 'q2',
          createdAt: now,
        ),
        Message(
          id: 'a2',
          conversationId: 'c',
          role: ChatRole.assistant,
          content: '   ',
          createdAt: now,
        ),
        Message(
          id: 'a3',
          conversationId: 'c',
          role: ChatRole.assistant,
          content: 'ok',
          status: MessageStatus.done,
          createdAt: now,
        ),
      ];
      expect(historyFor(msgs), <Map<String, String>>[
        <String, String>{'role': 'user', 'content': 'q1'},
        <String, String>{'role': 'user', 'content': 'q2'},
        <String, String>{'role': 'assistant', 'content': 'ok'},
      ]);
    });
  });

  group('错误映射', () {
    test(
      'CONTENT_FILTERED：question+assistant 设 excludeFromContext 且固定文案',
      () async {
        final api = newApi();
        final store = newStore();
        final chat = newController(api, store);

        final future = chat.sendMessage('触发过滤');
        await Future<void>.delayed(const Duration(milliseconds: 10));
        final sc = api.last;
        sc.add(<String, dynamic>{'type': 'start', 'thinking': false});
        sc.addError(
          ChatApiError(
            code: 'CONTENT_FILTERED',
            hex: '0x1234',
            message: '内容过滤',
          ),
        );
        await sc.close();
        await future;

        final assistant = chat.allMessages.firstWhere(
          (m) => m.role == ChatRole.assistant,
        );
        expect(assistant.status, MessageStatus.done);
        expect(assistant.excludeFromContext, isTrue);
        expect(assistant.content, '这段对话触发了模型的内容安全策略，请修改最近几条消息，或新建一个会话再试。');
        final question = chat.allMessages.firstWhere(
          (m) => m.role == ChatRole.user,
        );
        expect(question.excludeFromContext, isTrue);
        expect(chat.streamError, isNull);
      },
    );

    test('网络错误：映射为 0x0001 固定文案', () async {
      final api = newApi();
      final store = newStore();
      final chat = newController(api, store);

      final future = chat.sendMessage('问题');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      final sc = api.last;
      sc.add(<String, dynamic>{'type': 'start', 'thinking': false});
      sc.addError(
        ChatApiError(code: 'NETWORK', hex: '0x0001', message: '网络连接失败'),
      );
      await sc.close();
      await future;

      final assistant = chat.allMessages.firstWhere(
        (m) => m.role == ChatRole.assistant,
      );
      expect(assistant.status, MessageStatus.error);
      expect(assistant.error, '0x0001 网络连接中断，请重试。');
      expect(chat.streamError, '0x0001 网络连接中断，请重试。');
    });
  });
}
