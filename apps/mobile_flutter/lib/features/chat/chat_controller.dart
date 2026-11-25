// 构造注入要求公开参数名（api/repo/crypto/session）配合私有字段，触发
// prefer_initializing_formals；与 attach/voice 控制器既有风格一致，故文件级忽略。
// ignore_for_file: prefer_initializing_formals

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/errors.dart';
import '../../core/history.dart';
import '../../core/models.dart';
import '../../core/tree.dart';
import '../../data/chat_repository.dart';
import '../../services/api_client.dart';
import '../../services/crypto_service.dart';
import '../../services/session_store.dart';

/// 聊天流接口：与 [ApiClient.chatStream] 对齐，但事件必须携带 `type` 字段，
/// 值 ∈ {start, thinking, delta, sources, refusal, done}。
abstract class ChatApi {
  Future<Stream<Map<String, dynamic>>> chatStream(
    Map<String, dynamic> body, {
    void Function()? onCancel,
  });
}

/// 生产适配器：包装 [ApiClient]。
///
/// 注意：core 的 `ApiClient.chatStream` 解析 SSE 时丢弃了 `event:` 名，
/// 这里只能按 data 的字段形状推断 `type`；`thinking` 与 `delta` 的 data
/// 都是 `{delta}`，因此 thinking 无法被可靠区分（会归为 delta）。
/// 真实场景需 Lead 在 core `api_client.dart` 注入事件名。
class ApiClientChatApi implements ChatApi {
  ApiClientChatApi(this._api);

  final ApiClient _api;

  @override
  Future<Stream<Map<String, dynamic>>> chatStream(
    Map<String, dynamic> body, {
    void Function()? onCancel,
  }) async {
    final stream = await _api.chatStream(body, onCancel: onCancel);
    return stream.map(_inferType);
  }

  static Map<String, dynamic> _inferType(Map<String, dynamic> map) {
    final rawEvent = map['_event'];
    if (rawEvent is String && rawEvent.isNotEmpty) {
      // 服务端事件名即语义：start/thinking/delta/sources/refusal/done/error。
      return <String, dynamic>{...map, 'type': rawEvent};
    }
    String type;
    if (map.containsKey('finishReason')) {
      type = 'done';
    } else if (map.containsKey('message')) {
      type = 'refusal';
    } else if (map.containsKey('sources')) {
      type = 'sources';
    } else if (map.containsKey('model')) {
      type = 'start';
    } else if (map.containsKey('delta')) {
      type = 'delta';
    } else {
      type = 'unknown';
    }
    return <String, dynamic>{...map, 'type': type};
  }
}

/// 持久化接口：镜像 [ChatRepository] 的聊天相关方法，便于测试注入内存 fake。
abstract class ChatStore {
  Future<List<Conversation>> listConversations();
  Future<Conversation?> getConversation(String id);
  Future<void> putConversation(Conversation conversation);
  Future<void> deleteConversationData(String id);
  Future<List<Message>> getMessages(String conversationId);
  Future<void> putMessage(Message message);
  Future<void> putMessages(List<Message> messages);
}

/// 生产适配器：包装 [ChatRepository]（repo 不解密，加密由调用方处理）。
class RepositoryChatStore implements ChatStore {
  RepositoryChatStore(this._repo);

  final ChatRepository _repo;

  @override
  Future<List<Conversation>> listConversations() => _repo.listConversations();

  @override
  Future<Conversation?> getConversation(String id) => _repo.getConversation(id);

  @override
  Future<void> putConversation(Conversation conversation) =>
      _repo.putConversation(conversation);

  @override
  Future<void> deleteConversationData(String id) =>
      _repo.deleteConversationData(id);

  @override
  Future<List<Message>> getMessages(String conversationId) =>
      _repo.getMessages(conversationId);

  @override
  Future<void> putMessage(Message message) => _repo.putMessage(message);

  @override
  Future<void> putMessages(List<Message> messages) =>
      _repo.putMessages(messages);
}

enum _ReplyEnd { done, refused, closed }

/// 聊天状态机控制器（对齐 docs/design/flutter-p1/chat.md）。
class ChatController extends ChangeNotifier {
  ChatController({
    required ChatApi api,
    required ChatStore repo,
    required CryptoService crypto,
    required SessionStore session,
  }) : _api = api,
       _repo = repo,
       _crypto = crypto,
       _session = session;

  static const _activeIdKey = 'dream-active-id';
  static const _backupRevKey = 'dream-backup-rev';
  static const _timeoutText = '生成超时，请稍后重试。';
  static const _networkText = '0x0001 网络连接中断，请重试。';
  static const _filteredText = '这段对话触发了模型的内容安全策略，请修改最近几条消息，或新建一个会话再试。';
  static final _networkRe = RegExp(
    r'input stream|stream closed|network|load failed|failed to fetch',
    caseSensitive: false,
  );

  final ChatApi _api;
  final ChatStore _repo;
  final CryptoService _crypto;
  final SessionStore _session;

  List<Conversation> conversations = <Conversation>[];
  String? activeId;
  List<Message> allMessages = <Message>[];
  bool streaming = false;
  bool thinking = false;

  /// 深度思考开关（UI 维护，默认关闭，避免每条消息都走高成本推理模型）。
  bool deepThinking = false;
  String? streamError;

  bool _sessionExpired = false;
  bool get sessionExpired => _sessionExpired;

  String? _sessionKeyCache;
  bool _sessionKeyLoaded = false;

  // 流式运行时状态。
  StreamSubscription<Map<String, dynamic>>? _sub;
  Completer<_ReplyEnd>? _replyCompleter;
  String? _activeAssistantId;
  StringBuffer _pending = StringBuffer();
  Timer? _tickTimer;
  Timer? _watchdogTimer;
  DateTime? _lastActivity;
  bool _stoppedByUser = false;

  static int _idCounter = 0;

  /// 计算可见消息链：getVisibleMessages + pickRoot。
  List<Message> get visibleMessages {
    final rootId = activeConversation?.rootMessageId ?? pickRoot(allMessages);
    return getVisibleMessages(allMessages, rootId: rootId);
  }

  Conversation? get activeConversation {
    final id = activeId;
    if (id == null) return null;
    for (final c in conversations) {
      if (c.id == id) return c;
    }
    return null;
  }

  @override
  void dispose() {
    _stopTimers();
    _sub?.cancel();
    _sub = null;
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------------------------

  Future<void> load() async {
    conversations = await _decryptConversations(
      await _repo.listConversations(),
    );
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_activeIdKey);
    if (saved != null && conversations.any((c) => c.id == saved)) {
      activeId = saved;
      await _loadMessages(saved);
    } else {
      activeId = null;
      allMessages = <Message>[];
    }
    notifyListeners();
  }

  Future<void> openConversation(String id) async {
    activeId = id;
    await _loadMessages(id);
    await _setActiveId(id);
    notifyListeners();
  }

  Future<void> newConversation() async {
    activeId = null;
    allMessages = <Message>[];
    streaming = false;
    thinking = false;
    streamError = null;
    await _setActiveId(null);
    notifyListeners();
  }

  Future<void> _loadMessages(String id) async {
    var messages = await _decryptMessages(await _repo.getMessages(id));
    messages = normalizeMessages(messages);
    var changed = false;
    final repaired = <Message>[];
    for (final m in messages) {
      if (m.status == MessageStatus.streaming) {
        repaired.add(m.copyWith(status: MessageStatus.stopped));
        changed = true;
      } else {
        repaired.add(m);
      }
    }
    allMessages = repaired;
    if (changed) {
      await _persistMessages(repaired);
    }
  }

  // ---------------------------------------------------------------------------
  // 发送 / 停止
  // ---------------------------------------------------------------------------

  Future<void> sendMessage(
    String text, {
    List<String> files = const <String>[],
    bool webSearch = false,
  }) async {
    final raw = text.trim();
    if (raw.isEmpty || streaming) return;

    final visible = visibleMessages;
    final now = DateTime.now();

    // 1. 会话。
    late Conversation conversation;
    final convId = activeId;
    if (convId == null) {
      conversation = Conversation(
        id: _newId('c'),
        title: makeTitle(raw),
        createdAt: now,
        updatedAt: now,
      );
      activeId = conversation.id;
      conversations = <Conversation>[conversation, ...conversations];
      await _persistConversation(conversation);
      await _setActiveId(conversation.id);
    } else {
      final existing = activeConversation;
      if (existing == null) return;
      conversation = existing;
    }

    // 2. 建树。
    final userMsg = Message(
      id: _newId('m'),
      conversationId: conversation.id,
      role: ChatRole.user,
      content: raw,
      status: MessageStatus.done,
      webSearch: webSearch,
      files: files,
      createdAt: now,
      parentId: visible.isEmpty ? null : visible.last.id,
    );
    final assistantMsg = Message(
      id: _newId('m'),
      conversationId: conversation.id,
      role: ChatRole.assistant,
      content: '',
      status: MessageStatus.streaming,
      createdAt: now.add(const Duration(milliseconds: 1)),
      parentId: userMsg.id,
    );
    final userWithChild = userMsg.copyWith(selectedChildId: assistantMsg.id);

    final rootId =
        conversation.rootMessageId ?? pickRoot(allMessages) ?? userMsg.id;

    Message? parentUpdated;
    if (visible.isNotEmpty) {
      parentUpdated = visible.last.copyWith(selectedChildId: userMsg.id);
    }

    final toAdd = <Message>[userWithChild, assistantMsg];
    if (parentUpdated != null) _updateMessage(parentUpdated);
    allMessages = <Message>[...allMessages, ...toAdd];

    // 3. 回写会话与消息。
    final convUpdated = conversation.copyWith(
      updatedAt: now,
      rootMessageId: rootId,
    );
    conversations = <Conversation>[
      for (final c in conversations)
        if (c.id == convUpdated.id) convUpdated else c,
    ];
    await _persistConversation(convUpdated);
    final persistList = <Message>[?parentUpdated, ...toAdd];
    await _persistMessages(persistList);

    // 4. 请求体。
    final history = <Map<String, String>>[
      ...historyFor(visible),
      <String, String>{'role': 'user', 'content': raw},
    ];
    final body = <String, dynamic>{
      'messages': history,
      'thinking': deepThinking,
    };
    if (files.isNotEmpty) body['files'] = files;
    if (webSearch) body['webSearch'] = true;

    notifyListeners();
    await _runReply(body: body, assistantId: assistantMsg.id);
  }

  void stop() {
    final id = _activeAssistantId;
    if (id == null) return;
    _stoppedByUser = true;
    _settlePending(id);
    _updateStatus(id, MessageStatus.stopped);
    unawaited(_persistCurrentMessage(id));
    _sub?.cancel();
    _sub = null;
    final completer = _replyCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.complete(_ReplyEnd.closed);
    }
    streaming = false;
    thinking = false;
    _stopTimers();
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // 编辑 / 重新生成 / 版本切换 / 删除会话
  // ---------------------------------------------------------------------------

  Future<void> editMessage(String messageId, String text) async {
    final raw = text.trim();
    if (raw.isEmpty || streaming) return;
    final previous = _byId(messageId);
    if (previous == null || previous.role != ChatRole.user) return;

    final visible = visibleMessages;
    final idx = visible.indexWhere((m) => m.id == messageId);
    if (idx < 0) return;
    final before = visible.sublist(0, idx);
    final parentId = previous.parentId;

    final now = DateTime.now();
    final newUser = Message(
      id: _newId('m'),
      conversationId: previous.conversationId,
      role: ChatRole.user,
      content: raw,
      status: MessageStatus.done,
      webSearch: previous.webSearch,
      files: previous.files,
      createdAt: now,
      parentId: parentId,
    );
    final newAssistant = Message(
      id: _newId('m'),
      conversationId: previous.conversationId,
      role: ChatRole.assistant,
      content: '',
      status: MessageStatus.streaming,
      createdAt: now.add(const Duration(milliseconds: 1)),
      parentId: newUser.id,
    );
    final newUserWithChild = newUser.copyWith(selectedChildId: newAssistant.id);

    Message? parentUpdated;
    if (parentId != null) {
      final parent = _byId(parentId);
      if (parent != null) {
        parentUpdated = parent.copyWith(selectedChildId: newUser.id);
      }
    }

    final isRootEdit = parentId == null;
    String? newRoot;
    if (isRootEdit) newRoot = newUser.id;

    if (parentUpdated != null) _updateMessage(parentUpdated);
    allMessages = <Message>[...allMessages, newUserWithChild, newAssistant];

    final conv = activeConversation;
    if (conv != null) {
      final convUpdated = isRootEdit
          ? conv.copyWith(updatedAt: now, rootMessageId: newRoot)
          : conv.copyWith(updatedAt: now);
      conversations = <Conversation>[
        for (final c in conversations)
          if (c.id == conv.id) convUpdated else c,
      ];
      await _persistConversation(convUpdated);
    }
    await _persistMessages(<Message>[
      ?parentUpdated,
      newUserWithChild,
      newAssistant,
    ]);

    final history = <Map<String, String>>[
      ...historyFor(before),
      <String, String>{'role': 'user', 'content': raw},
    ];
    final body = <String, dynamic>{
      'messages': history,
      'thinking': deepThinking,
    };
    if (previous.webSearch) body['webSearch'] = true;
    if (previous.files.isNotEmpty) body['files'] = previous.files;

    notifyListeners();
    await _runReply(body: body, assistantId: newAssistant.id);
  }

  Future<void> regenerate(String assistantId) async {
    if (streaming) return;
    final target = _byId(assistantId);
    if (target == null ||
        target.role != ChatRole.assistant ||
        target.parentId == null) {
      return;
    }
    final question = _byId(target.parentId!);
    if (question == null || question.role != ChatRole.user) return;
    if (question.excludeFromContext) return;
    if (!_pathEndsWithUser(question)) return;

    final visible = visibleMessages;
    final qIdx = visible.indexWhere((m) => m.id == question.id);
    if (qIdx < 0) return;
    final before = visible.sublist(0, qIdx + 1);

    final now = DateTime.now();
    final newAssistant = Message(
      id: _newId('m'),
      conversationId: target.conversationId,
      role: ChatRole.assistant,
      content: '',
      status: MessageStatus.streaming,
      createdAt: now,
      parentId: question.id,
    );
    final questionUpdated = question.copyWith(selectedChildId: newAssistant.id);

    _updateMessage(questionUpdated);
    allMessages = <Message>[...allMessages, newAssistant];
    await _persistMessages(<Message>[questionUpdated, newAssistant]);

    final history = historyFor(before);
    final body = <String, dynamic>{
      'messages': history,
      'thinking': deepThinking,
    };
    if (question.webSearch) body['webSearch'] = true;
    if (question.files.isNotEmpty) body['files'] = question.files;

    notifyListeners();
    await _runReply(body: body, assistantId: newAssistant.id);
  }

  Future<void> selectMessageVersion(String messageId) async {
    final target = _byId(messageId);
    if (target == null) return;

    if (target.parentId == null) {
      final conv = activeConversation;
      if (conv != null) {
        final updated = conv.copyWith(
          rootMessageId: messageId,
          updatedAt: DateTime.now(),
        );
        conversations = <Conversation>[
          for (final c in conversations)
            if (c.id == conv.id) updated else c,
        ];
        await _persistConversation(updated);
      }
    } else {
      final parent = _byId(target.parentId!);
      if (parent != null) {
        final updated = parent.copyWith(selectedChildId: messageId);
        _updateMessage(updated);
        await _persistMessage(updated);
      }
    }
    notifyListeners();
  }

  Future<void> removeConversation(String id) async {
    await _repo.deleteConversationData(id);
    conversations = conversations.where((c) => c.id != id).toList();
    if (activeId == id) {
      activeId = null;
      allMessages = <Message>[];
      await _setActiveId(null);
    }
    await _markBackupDirty();
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // 流式处理
  // ---------------------------------------------------------------------------

  Future<void> _runReply({
    required Map<String, dynamic> body,
    required String assistantId,
  }) async {
    streaming = true;
    thinking = false;
    streamError = null;
    _stoppedByUser = false;
    _activeAssistantId = assistantId;
    _pending = StringBuffer();
    _lastActivity = DateTime.now();
    _startTick();
    _startWatchdog();
    notifyListeners();

    final Stream<Map<String, dynamic>> stream;
    try {
      stream = await _api.chatStream(body, onCancel: () {});
    } catch (e) {
      await _handleFatal(e, assistantId);
      _teardownReply();
      return;
    }

    final completer = Completer<_ReplyEnd>();
    _replyCompleter = completer;
    _sub = stream.listen(
      (event) {
        _lastActivity = DateTime.now();
        _handleEvent(event, assistantId, completer);
      },
      onError: (Object error) {
        if (!completer.isCompleted) completer.completeError(error);
      },
      onDone: () {
        if (!completer.isCompleted) completer.complete(_ReplyEnd.closed);
      },
      cancelOnError: false,
    );

    try {
      final end = await completer.future;
      switch (end) {
        case _ReplyEnd.done:
          await _finishAndPersist(assistantId, MessageStatus.done);
          break;
        case _ReplyEnd.refused:
          await _finishAndPersist(assistantId, MessageStatus.refused);
          break;
        case _ReplyEnd.closed:
          if (!_stoppedByUser) {
            final m = _byId(assistantId);
            if (m != null && m.status == MessageStatus.streaming) {
              await _settleAndPersist(assistantId, MessageStatus.stopped);
            }
          }
          break;
      }
    } on ChatApiError catch (e) {
      await _handleChatError(e, assistantId);
    } catch (_) {
      if (!_stoppedByUser) {
        final m = _byId(assistantId);
        if (m != null && m.status == MessageStatus.streaming) {
          await _settleAndPersist(assistantId, MessageStatus.stopped);
        }
      }
    } finally {
      _teardownReply();
    }
  }

  void _handleEvent(
    Map<String, dynamic> event,
    String assistantId,
    Completer<_ReplyEnd> completer,
  ) {
    final type = event['type'] as String? ?? 'unknown';
    switch (type) {
      case 'start':
        thinking = event['thinking'] == true;
        notifyListeners();
        break;
      case 'thinking':
        thinking = true;
        _appendReasoning(assistantId, event['delta'] as String? ?? '');
        break;
      case 'delta':
        thinking = false;
        _pending.write(event['delta'] as String? ?? '');
        break;
      case 'sources':
        _setSources(assistantId, event['sources']);
        break;
      case 'refusal':
        thinking = false;
        _settlePending(assistantId);
        _appendContent(assistantId, event['message'] as String? ?? '');
        if (!completer.isCompleted) completer.complete(_ReplyEnd.refused);
        break;
      case 'done':
        thinking = false;
        _settlePending(assistantId);
        if (!completer.isCompleted) completer.complete(_ReplyEnd.done);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // 流式 tick / watchdog
  // ---------------------------------------------------------------------------

  void _startTick() {
    _tickTimer ??= Timer.periodic(
      const Duration(milliseconds: 30),
      (_) => _tick(),
    );
  }

  void _tick() {
    if (_pending.isEmpty) return;
    final text = _pending.toString();
    final n = text.length > 160 ? 8 : (text.length > 60 ? 6 : 4);
    final chunk = text.length <= n ? text : text.substring(0, n);
    _pending = StringBuffer(text.substring(chunk.length));
    final id = _activeAssistantId;
    if (id != null) _appendContent(id, chunk);
  }

  void _startWatchdog() {
    _lastActivity = DateTime.now();
    _watchdogTimer ??= Timer.periodic(const Duration(seconds: 10), (_) {
      final last = _lastActivity;
      if (last != null &&
          DateTime.now().difference(last) > const Duration(seconds: 90)) {
        _timeoutReply();
      }
    });
  }

  void _timeoutReply() {
    final id = _activeAssistantId;
    if (id == null) return;
    _settlePending(id);
    _updateStatus(id, MessageStatus.error, error: _timeoutText);
    streamError = _timeoutText;
    unawaited(_persistCurrentMessage(id));
    _sub?.cancel();
    _sub = null;
    final completer = _replyCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.complete(_ReplyEnd.closed);
    }
    _stopTimers();
    notifyListeners();
  }

  void _teardownReply() {
    _stopTimers();
    _sub = null;
    _replyCompleter = null;
    _activeAssistantId = null;
    _pending = StringBuffer();
    streaming = false;
    thinking = false;
    notifyListeners();
  }

  void _stopTimers() {
    _tickTimer?.cancel();
    _tickTimer = null;
    _watchdogTimer?.cancel();
    _watchdogTimer = null;
  }

  // ---------------------------------------------------------------------------
  // 错误处理
  // ---------------------------------------------------------------------------

  Future<void> _handleChatError(ChatApiError e, String assistantId) async {
    thinking = false;
    _settlePending(assistantId);

    if (e.status == 401) {
      _sessionExpired = true;
      streamError = e.fullMessage;
      await _finishAndPersist(
        assistantId,
        MessageStatus.error,
        error: e.fullMessage,
        errorCode: e.code,
        errorRequestId: e.requestId,
      );
      return;
    }

    if (e.code == 'CONTENT_FILTERED') {
      await _markContentFiltered(assistantId);
      return;
    }

    final message = _isNetwork(e) ? _networkText : e.fullMessage;
    streamError = message;
    await _finishAndPersist(
      assistantId,
      MessageStatus.error,
      error: message,
      errorCode: e.code,
      errorRequestId: e.requestId,
    );
  }

  Future<void> _handleFatal(Object e, String assistantId) async {
    final err = e is ChatApiError ? e : ChatApiError.unknown();
    await _handleChatError(err, assistantId);
  }

  Future<void> _markContentFiltered(String assistantId) async {
    final assistant = _byId(assistantId);
    if (assistant == null) return;

    final assistantUpdated = assistant.copyWith(
      status: MessageStatus.done,
      excludeFromContext: true,
      content: _filteredText,
    );
    _updateMessage(assistantUpdated);
    await _persistMessage(assistantUpdated);

    final question = assistant.parentId != null
        ? _byId(assistant.parentId!)
        : null;
    if (question != null) {
      final qUpdated = question.copyWith(excludeFromContext: true);
      _updateMessage(qUpdated);
      await _persistMessage(qUpdated);
    }
    streamError = null;
  }

  bool _isNetwork(ChatApiError e) {
    if (e.code == 'NETWORK' || e.hex == clientErrorHex['NETWORK']) return true;
    return _networkRe.hasMatch(e.message);
  }

  // ---------------------------------------------------------------------------
  // 内存状态工具
  // ---------------------------------------------------------------------------

  Message? _byId(String id) {
    for (final m in allMessages) {
      if (m.id == id) return m;
    }
    return null;
  }

  void _updateMessage(Message message) {
    allMessages = <Message>[
      for (final m in allMessages)
        if (m.id == message.id) message else m,
    ];
  }

  void _updateStatus(String id, MessageStatus status, {String? error}) {
    final m = _byId(id);
    if (m == null) return;
    _updateMessage(m.copyWith(status: status, error: error));
  }

  void _appendContent(String id, String chunk) {
    final m = _byId(id);
    if (m == null) return;
    _updateMessage(m.copyWith(content: m.content + chunk));
    notifyListeners();
  }

  void _appendReasoning(String id, String chunk) {
    final m = _byId(id);
    if (m == null) return;
    _updateMessage(m.copyWith(reasoning: (m.reasoning ?? '') + chunk));
    notifyListeners();
  }

  void _setSources(String id, dynamic sources) {
    final m = _byId(id);
    if (m == null) return;
    final list = sources is List
        ? sources
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
        : <Map<String, dynamic>>[];
    _updateMessage(m.copyWith(sources: list));
    notifyListeners();
  }

  void _settlePending(String id) {
    if (_pending.isEmpty) return;
    final chunk = _pending.toString();
    _pending = StringBuffer();
    _appendContent(id, chunk);
  }

  Future<void> _settleAndPersist(
    String assistantId,
    MessageStatus status, {
    String? error,
    String? errorCode,
    String? errorRequestId,
  }) async {
    _settlePending(assistantId);
    await _finishAndPersist(
      assistantId,
      status,
      error: error,
      errorCode: errorCode,
      errorRequestId: errorRequestId,
    );
  }

  Future<void> _finishAndPersist(
    String assistantId,
    MessageStatus status, {
    String? error,
    String? errorCode,
    String? errorRequestId,
  }) async {
    final m = _byId(assistantId);
    if (m == null) return;
    final updated = m.copyWith(
      status: status,
      error: error,
      errorCode: errorCode,
      errorRequestId: errorRequestId,
    );
    _updateMessage(updated);
    await _persistMessage(updated);
    notifyListeners();
  }

  bool _pathEndsWithUser(Message message) {
    var cur = message.parentId;
    var rootId = message.id;
    while (cur != null) {
      final m = _byId(cur);
      if (m == null) break;
      rootId = m.id;
      cur = m.parentId;
    }
    final root = _byId(rootId);
    return root != null && root.role == ChatRole.user;
  }

  // ---------------------------------------------------------------------------
  // 持久化（加密）工具
  // ---------------------------------------------------------------------------

  Future<String?> _sessionKey() async {
    if (_sessionKeyLoaded) return _sessionKeyCache;
    _sessionKeyCache = await _session.getSessionKey();
    _sessionKeyLoaded = true;
    return _sessionKeyCache;
  }

  Future<void> _persistConversation(Conversation conversation) async {
    final key = await _sessionKey();
    if (key == null) {
      await _repo.putConversation(conversation);
    } else {
      await _repo.putConversation(
        await _encryptConversation(conversation, key),
      );
    }
    await _markBackupDirty();
  }

  Future<void> _persistMessage(Message message) async {
    final key = await _sessionKey();
    if (key == null) {
      await _repo.putMessage(message);
    } else {
      await _repo.putMessage(await _encryptMessage(message, key));
    }
    await _markBackupDirty();
  }

  Future<void> _persistMessages(List<Message> messages) async {
    final key = await _sessionKey();
    if (key == null) {
      await _repo.putMessages(messages);
    } else {
      final encrypted = <Message>[];
      for (final m in messages) {
        encrypted.add(await _encryptMessage(m, key));
      }
      await _repo.putMessages(encrypted);
    }
    await _markBackupDirty();
  }

  Future<void> _persistCurrentMessage(String id) async {
    final m = _byId(id);
    if (m == null) return;
    await _persistMessage(m);
  }

  Future<Conversation> _encryptConversation(
    Conversation conversation,
    String key,
  ) async {
    if (conversation.encTitle != null) return conversation;
    return conversation.copyWith(
      title: '',
      encTitle: await _crypto.encryptText(conversation.title, key),
    );
  }

  Future<Message> _encryptMessage(Message message, String key) async {
    if (message.enc != null || message.encReasoning != null) return message;
    final content = message.content;
    final reasoning = message.reasoning;
    return Message(
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      content: '',
      reasoning: null,
      status: message.status,
      excludeFromContext: message.excludeFromContext,
      error: message.error,
      errorCode: message.errorCode,
      errorRequestId: message.errorRequestId,
      webSearch: message.webSearch,
      files: message.files,
      sources: message.sources,
      createdAt: message.createdAt,
      parentId: message.parentId,
      selectedChildId: message.selectedChildId,
      enc: await _crypto.encryptText(content, key),
      encReasoning: reasoning != null && reasoning.isNotEmpty
          ? await _crypto.encryptText(reasoning, key)
          : null,
    );
  }

  Future<List<Conversation>> _decryptConversations(
    List<Conversation> conversations,
  ) async {
    final key = await _sessionKey();
    if (key == null) return conversations;
    final result = <Conversation>[];
    for (final c in conversations) {
      final dec = await _decryptConversation(c, key);
      if (dec != null) result.add(dec);
    }
    return result;
  }

  Future<Conversation?> _decryptConversation(
    Conversation conversation,
    String key,
  ) async {
    if (conversation.encTitle == null) return conversation;
    final title = await _crypto.decryptText(conversation.encTitle!, key);
    if (title == null) return null;
    return Conversation(
      id: conversation.id,
      title: title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      rootMessageId: conversation.rootMessageId,
    );
  }

  Future<List<Message>> _decryptMessages(List<Message> messages) async {
    final key = await _sessionKey();
    if (key == null) return messages;
    final result = <Message>[];
    for (final m in messages) {
      final dec = await _decryptMessage(m, key);
      if (dec != null) result.add(dec);
    }
    return result;
  }

  Future<Message?> _decryptMessage(Message message, String key) async {
    if (message.enc == null && message.encReasoning == null) return message;

    var content = message.content;
    if (message.enc != null) {
      final dec = await _crypto.decryptText(message.enc!, key);
      if (dec == null) return null;
      content = dec;
    }

    var reasoning = message.reasoning;
    if (message.encReasoning != null) {
      final dec = await _crypto.decryptText(message.encReasoning!, key);
      if (dec == null) return null;
      reasoning = dec;
    }

    return Message(
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      content: content,
      reasoning: reasoning,
      status: message.status,
      excludeFromContext: message.excludeFromContext,
      error: message.error,
      errorCode: message.errorCode,
      errorRequestId: message.errorRequestId,
      webSearch: message.webSearch,
      files: message.files,
      sources: message.sources,
      createdAt: message.createdAt,
      parentId: message.parentId,
      selectedChildId: message.selectedChildId,
    );
  }

  Future<void> _setActiveId(String? id) async {
    final prefs = await SharedPreferences.getInstance();
    if (id == null) {
      await prefs.remove(_activeIdKey);
    } else {
      await prefs.setString(_activeIdKey, id);
    }
  }

  Future<void> _markBackupDirty() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _backupRevKey,
      DateTime.now().millisecondsSinceEpoch.toString(),
    );
  }

  String _newId(String prefix) {
    _idCounter++;
    return '$prefix-${DateTime.now().microsecondsSinceEpoch}-$_idCounter';
  }
}
