/// 归档导入：URL（NDJSON 流，服务端已归一化）+ 本地 ZIP（manifest v3 + chat_sessions）。
library;

// ignore_for_file: prefer_initializing_formals

import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:http/http.dart' as http;

import '../../core/errors.dart';
import '../../core/models.dart';
import '../../data/chat_repository.dart';
import '../../services/api_client.dart';

class ArchiveImportException implements Exception {
  ArchiveImportException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ArchiveStats {
  const ArchiveStats({
    this.conversations = 0,
    this.messages = 0,
    this.skippedConversations = 0,
    this.skippedMessages = 0,
  });

  final int conversations;
  final int messages;
  final int skippedConversations;
  final int skippedMessages;
}

/// 归档会话 id：`ds-<session.id>`。
String archiveConversationId(String sessionId) => 'ds-$sessionId';

/// 归档消息 id：`ds-<session.id>-<message.id>`。
String archiveMessageId(String sessionId, dynamic messageId) =>
    'ds-$sessionId-$messageId';

/// 标题截断（对齐服务端 makeTitle）。
String archiveMakeTitle(String text) {
  final clean = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  return clean.length > 24 ? '${clean.substring(0, 24)}…' : clean;
}

/// 沿 current_message_id / parent_id 回溯得到当前分支（时间顺序）。
List<Map<String, dynamic>> currentArchiveBranch(
  List<Map<String, dynamic>> messages,
  dynamic currentMessageId,
) {
  final byId = <dynamic, Map<String, dynamic>>{
    for (final m in messages) m['id']: m,
  };
  var current = byId[currentMessageId];
  if (current == null && messages.isNotEmpty) {
    final sorted = [...messages]
      ..sort((a, b) => _numId(a['id']).compareTo(_numId(b['id'])));
    current = sorted.last;
  }
  final path = <Map<String, dynamic>>[];
  final seen = <dynamic>{};
  while (current != null && !seen.contains(current['id'])) {
    seen.add(current['id']);
    path.add(current);
    final parent = current['parent_id'];
    if (parent == null) break;
    current = byId[parent];
  }
  return path.reversed.toList();
}

/// 纯函数：把 manifest v3 单会话转为本地 Conversation + Message。
///
/// fragment 映射：REQUEST→user、RESPONSE/TEMPLATE_RESPONSE→assistant 正文、
/// THINK→reasoning、FILE→附件；status∈{FAILED,TIMEOUT,CONTEXT_LENGTH_EXCEEDED}→error。
({Conversation conversation, List<Message> messages}) convertArchiveSession(
  Map<String, dynamic> session, {
  DateTime? now,
}) {
  final sessionId = session['id']?.toString() ?? '';
  final fallback = now ?? DateTime.fromMillisecondsSinceEpoch(0);
  final insertedAt = _timeOf(session['inserted_at'], fallback);
  final rawUpdated = _timeOf(session['updated_at'], insertedAt);
  final updatedAt = rawUpdated.isBefore(insertedAt) ? insertedAt : rawUpdated;

  final rawMessages =
      (session['messages'] as List?)
          ?.whereType<Map>()
          .map((m) => Map<String, dynamic>.from(m))
          .toList() ??
      const <Map<String, dynamic>>[];
  final branch = currentArchiveBranch(
    rawMessages,
    session['current_message_id'],
  );

  final messages = <Message>[];
  var previousTime = insertedAt;
  for (final m in branch) {
    var createdAt = _timeOf(m['inserted_at'], previousTime);
    if (createdAt.isBefore(previousTime)) createdAt = previousTime;
    previousTime = createdAt;

    final fragments =
        (m['fragments'] as List?)
            ?.whereType<Map>()
            .map((f) => Map<String, dynamic>.from(f))
            .toList() ??
        const <Map<String, dynamic>>[];
    final id = m['id']?.toString() ?? '';
    final parentId = m['parent_id'];
    final parent = parentId != null
        ? archiveMessageId(sessionId, parentId.toString())
        : null;
    final files = _attachmentRefs(fragments);

    if ((m['role'] as String?) == 'USER') {
      final content = _userText(fragments);
      if (content.isEmpty) continue;
      messages.add(
        Message(
          id: archiveMessageId(sessionId, id),
          conversationId: archiveConversationId(sessionId),
          role: ChatRole.user,
          content: content,
          status: MessageStatus.done,
          files: files,
          createdAt: createdAt,
          parentId: parent,
        ),
      );
      continue;
    }

    final parts = _assistantParts(fragments);
    if (parts.content.isEmpty && parts.reasoning.isEmpty) continue;
    final failed = _isFailed(m['status'] as String? ?? '');
    messages.add(
      Message(
        id: archiveMessageId(sessionId, id),
        conversationId: archiveConversationId(sessionId),
        role: ChatRole.assistant,
        content: parts.content,
        reasoning: parts.reasoning.isEmpty ? null : parts.reasoning,
        status: failed ? MessageStatus.error : MessageStatus.done,
        error: failed ? '这条回复生成失败或超长中断。' : null,
        files: files,
        createdAt: createdAt,
        parentId: parent,
      ),
    );
  }

  var firstUser = '';
  for (final m in messages) {
    if (m.role == ChatRole.user) {
      firstUser = m.content;
      break;
    }
  }
  final rawTitle = (session['title'] as String? ?? '').trim();
  final title = rawTitle.isNotEmpty
      ? rawTitle
      : (archiveMakeTitle(firstUser).isNotEmpty
            ? archiveMakeTitle(firstUser)
            : '未命名对话');

  final conversation = Conversation(
    id: archiveConversationId(sessionId),
    title: title,
    createdAt: insertedAt,
    updatedAt: updatedAt,
  );
  return (conversation: conversation, messages: messages);
}

class ArchiveImportController {
  ArchiveImportController({
    required ApiClient api,
    required ChatRepository repo,
  }) : _api = api,
       _repo = repo;

  final ApiClient _api;
  final ChatRepository _repo;

  /// 从 URL 导入（服务端已归一化为 NDJSON），逐批写库。
  Future<ArchiveStats> importArchive(
    String url, {
    List<String> skipIds = const [],
  }) async {
    final client = http.Client();
    try {
      final request = http.Request(
        'POST',
        Uri.parse('${_api.baseUrl}/api/v1/import/archive'),
      );
      request.headers['accept'] = 'application/x-ndjson';
      request.headers['content-type'] = 'application/json';
      final token = _api.tokenProvider();
      if (token.isNotEmpty) request.headers['authorization'] = 'Bearer $token';
      request.body = jsonEncode({'url': url, 'skipIds': skipIds});

      final response = await client
          .send(request)
          .timeout(const Duration(minutes: 10));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final body = await response.stream.bytesToString();
        throw _errorFromBody(body, response.statusCode);
      }

      var conversations = 0;
      var messages = 0;
      var skippedConversations = 0;
      var skippedMessages = 0;
      await for (final line
          in response.stream
              .transform(utf8.decoder)
              .transform(const LineSplitter())) {
        if (line.trim().isEmpty) continue;
        final Object? decoded;
        try {
          decoded = jsonDecode(line);
        } catch (_) {
          continue;
        }
        if (decoded is! Map) continue;
        final event = Map<String, dynamic>.from(decoded);
        switch (event['type']) {
          case 'conversation':
            final conv = event['conversation'];
            if (conv is Map) {
              await _repo.putConversation(
                Conversation.fromJson(Map<String, dynamic>.from(conv)),
              );
              conversations += 1;
            }
          case 'messages':
            final msgs = event['messages'];
            if (msgs is List) {
              final list = msgs
                  .whereType<Map>()
                  .map((m) => Message.fromJson(Map<String, dynamic>.from(m)))
                  .toList();
              if (list.isNotEmpty) await _repo.putMessages(list);
              messages += list.length;
            }
          case 'warning':
            skippedConversations += 1;
          case 'error':
            throw ArchiveImportException(
              event['message'] as String? ?? '归档导入失败',
            );
          case 'done':
            final stats = event['stats'];
            if (stats is Map) {
              skippedConversations =
                  stats['skippedConversations'] as int? ?? skippedConversations;
              skippedMessages =
                  stats['skippedMessages'] as int? ?? skippedMessages;
            }
        }
      }
      return ArchiveStats(
        conversations: conversations,
        messages: messages,
        skippedConversations: skippedConversations,
        skippedMessages: skippedMessages,
      );
    } finally {
      client.close();
    }
  }

  /// 从本地 ZIP 导入：解压 manifest.json + chat_sessions/*.json。
  Future<ArchiveStats> importArchiveZip(
    String zipPath, {
    List<String> skipIds = const [],
  }) async {
    final bytes = await File(zipPath).readAsBytes();
    final archive = ZipDecoder().decodeBytes(bytes);

    Map<String, dynamic>? manifest;
    final sessions = <Map<String, dynamic>>[];
    for (final file in archive) {
      if (!file.isFile) continue;
      final name = file.name;
      if (name == 'manifest.json') {
        final decoded = jsonDecode(utf8.decode(file.content));
        if (decoded is Map) manifest = Map<String, dynamic>.from(decoded);
      } else if (name.startsWith('chat_sessions/') && name.endsWith('.json')) {
        final id = name.substring('chat_sessions/'.length, name.length - 5);
        if (skipIds.contains('ds-$id')) continue;
        final decoded = jsonDecode(utf8.decode(file.content));
        if (decoded is Map) sessions.add(Map<String, dynamic>.from(decoded));
      }
    }

    if (manifest == null) {
      throw ArchiveImportException('导出文件缺少 manifest.json，可能不完整。');
    }
    final version = manifest['export_format_version'];
    if (version != 3) {
      throw ArchiveImportException('暂不支持导出格式版本 ${version ?? '未知'}。');
    }

    var conversations = 0;
    var messages = 0;
    for (final session in sessions) {
      final result = convertArchiveSession(session);
      if (result.messages.isEmpty) continue;
      await _repo.putConversation(result.conversation);
      await _repo.putMessages(result.messages);
      conversations += 1;
      messages += result.messages.length;
    }
    return ArchiveStats(conversations: conversations, messages: messages);
  }
}

ChatApiError _errorFromBody(String body, int status) {
  Map<String, dynamic> error = const {};
  try {
    final decoded = jsonDecode(body);
    if (decoded is Map && decoded['error'] is Map) {
      error = Map<String, dynamic>.from(decoded['error'] as Map);
    }
  } catch (_) {
    // 非 JSON 错误体。
  }
  return ChatApiError.fromServerError(error, status: status);
}

String _userText(List<Map<String, dynamic>> fragments) {
  final buffer = StringBuffer();
  for (final fragment in fragments) {
    final content = fragment['content'];
    if (fragment['type'] == 'REQUEST' && content is String) {
      buffer.write(content);
    }
  }
  return buffer.toString().trim();
}

({String content, String reasoning}) _assistantParts(
  List<Map<String, dynamic>> fragments,
) {
  final content = StringBuffer();
  final reasoning = <String>[];
  for (final fragment in fragments) {
    final c = fragment['content'];
    if (c is! String) continue;
    final type = fragment['type'];
    if (type == 'RESPONSE' || type == 'TEMPLATE_RESPONSE') {
      content.write(c);
    } else if (type == 'THINK') {
      reasoning.add(c);
    }
  }
  return (
    content: content.toString(),
    reasoning: reasoning.join('\n\n').trim(),
  );
}

List<String> _attachmentRefs(List<Map<String, dynamic>> fragments) {
  final refs = <String>[];
  for (final fragment in fragments) {
    if (fragment['type'] != 'FILE') continue;
    final files = fragment['files'];
    if (files is List) {
      refs.addAll(files.map((f) => f.toString()));
    } else {
      final content = fragment['content'];
      if (content is String && content.isNotEmpty) refs.add(content);
    }
  }
  return refs;
}

bool _isFailed(String status) =>
    status == 'FAILED' ||
    status == 'TIMEOUT' ||
    status == 'CONTEXT_LENGTH_EXCEEDED';

DateTime _timeOf(dynamic value, DateTime fallback) {
  if (value is String) {
    final parsed = DateTime.tryParse(value);
    if (parsed != null) return parsed;
  }
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  return fallback;
}

num _numId(dynamic id) {
  if (id is num) return id;
  return num.tryParse(id?.toString() ?? '') ?? 0;
}
