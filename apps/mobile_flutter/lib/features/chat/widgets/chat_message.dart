/// 聊天消息数据模型（P0：仅 `user` / `assistant` 两角色，无思考、无分支）。
enum ChatRole { user, assistant }

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.role,
    required this.text,
    this.isStreaming = false,
    this.isError = false,
    required this.createdAt,
  });

  final String id;
  final ChatRole role;
  final String text;
  final bool isStreaming;
  final bool isError;
  final DateTime createdAt;
}
