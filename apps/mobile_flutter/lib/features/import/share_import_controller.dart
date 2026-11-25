/// 分享链接导入：`GET /import/share` → 转本地会话/消息并写库。
library;

// ignore_for_file: prefer_initializing_formals

import '../../core/models.dart';
import '../../data/chat_repository.dart';
import '../../services/api_client.dart';

/// 分享会话 id：`ds-share-<shareId>`。
String shareConversationId(String shareId) => 'ds-share-$shareId';

/// 分享消息 id：`ds-share-<shareId>-<idx+1>`。
String shareMessageId(String shareId, int index) =>
    'ds-share-$shareId-${index + 1}';

/// 纯函数：把服务端 `SharedChatResponse` 转为本地 Conversation + Message。
///
/// `reasoning` → Message.reasoning（web 的 thinking 块）；`status` 仅 done/error。
({Conversation conversation, List<Message> messages}) convertShare({
  required String shareId,
  required Map<String, dynamic> data,
  required DateTime now,
}) {
  final title = data['title'] as String? ?? '';
  final rawMessages = data['messages'];
  final messages = <Message>[];
  if (rawMessages is List) {
    for (var index = 0; index < rawMessages.length; index++) {
      final item = rawMessages[index];
      if (item is! Map) continue;
      final map = Map<String, dynamic>.from(item);
      final roleName = map['role'] as String? ?? 'user';
      final statusName = map['status'] as String? ?? 'done';
      final createdAt = _dateFromMs(map['createdAt']);
      messages.add(
        Message(
          id: shareMessageId(shareId, index),
          conversationId: shareConversationId(shareId),
          role: roleName == 'assistant' ? ChatRole.assistant : ChatRole.user,
          content: map['content'] as String? ?? '',
          reasoning: map['reasoning'] as String?,
          status: statusName == 'error'
              ? MessageStatus.error
              : MessageStatus.done,
          createdAt: createdAt,
        ),
      );
    }
  }
  final conversation = Conversation(
    id: shareConversationId(shareId),
    title: title,
    createdAt: now,
    updatedAt: now,
  );
  return (conversation: conversation, messages: messages);
}

class ShareImportController {
  ShareImportController({required ApiClient api, required ChatRepository repo})
    : _api = api,
      _repo = repo;

  final ApiClient _api;
  final ChatRepository _repo;

  /// 导入分享链接（链接或纯 id）：同 id 先删再替换。
  Future<void> importShare(String urlOrId) async {
    final data = await _api.importShare(urlOrId);
    final shareId = data['shareId'] as String? ?? '';
    if (shareId.isEmpty) {
      throw const FormatException('分享链接无效');
    }
    final result = convertShare(
      shareId: shareId,
      data: data,
      now: DateTime.now(),
    );
    final existing = await _repo.getConversation(result.conversation.id);
    if (existing != null) {
      await _repo.deleteConversationData(result.conversation.id);
    }
    await _repo.putConversation(result.conversation);
    if (result.messages.isNotEmpty) {
      await _repo.putMessages(result.messages);
    }
  }
}

DateTime _dateFromMs(dynamic value) {
  final ms = value is int
      ? value
      : value is String
      ? int.tryParse(value)
      : null;
  return DateTime.fromMillisecondsSinceEpoch(ms ?? 0);
}
