/// 领域模型：与 web 端语义对齐，JSON 中时间统一存毫秒时间戳（int）。
library;

enum ChatRole { user, assistant }

enum MessageStatus { streaming, done, refused, stopped, error }

DateTime _dateFromJson(dynamic value) {
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  if (value is String) {
    final ms = int.tryParse(value);
    if (ms != null) return DateTime.fromMillisecondsSinceEpoch(ms);
    final parsed = DateTime.tryParse(value);
    if (parsed != null) return parsed;
  }
  return DateTime.fromMillisecondsSinceEpoch(0);
}

List<String> _stringListFromJson(dynamic value) {
  if (value is! List) return const [];
  return value.map((e) => e.toString()).toList();
}

List<Map<String, dynamic>> _sourceListFromJson(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((e) => Map<String, dynamic>.from(e))
      .toList();
}

class Conversation {
  final String id;
  final String title;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? rootMessageId;
  final String? encTitle;

  const Conversation({
    required this.id,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
    this.rootMessageId,
    this.encTitle,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'createdAt': createdAt.millisecondsSinceEpoch,
    'updatedAt': updatedAt.millisecondsSinceEpoch,
    'rootMessageId': rootMessageId,
    'encTitle': encTitle,
  };

  factory Conversation.fromJson(Map<String, dynamic> json) => Conversation(
    id: json['id'] as String,
    title: json['title'] as String? ?? '',
    createdAt: _dateFromJson(json['createdAt']),
    updatedAt: _dateFromJson(json['updatedAt']),
    rootMessageId: json['rootMessageId'] as String?,
    encTitle: json['encTitle'] as String?,
  );

  Conversation copyWith({
    String? id,
    String? title,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? rootMessageId,
    String? encTitle,
  }) => Conversation(
    id: id ?? this.id,
    title: title ?? this.title,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    rootMessageId: rootMessageId ?? this.rootMessageId,
    encTitle: encTitle ?? this.encTitle,
  );
}

class Message {
  final String id;
  final String conversationId;
  final ChatRole role;
  final String content;
  final String? reasoning;
  final MessageStatus status;
  final bool excludeFromContext;
  final String? error;
  final String? errorCode;
  final String? errorRequestId;
  final bool webSearch;
  final List<String> files;
  final List<Map<String, dynamic>> sources;
  final DateTime createdAt;
  final String? parentId;
  final String? selectedChildId;
  final String? enc;
  final String? encReasoning;

  const Message({
    required this.id,
    required this.conversationId,
    required this.role,
    this.content = '',
    this.reasoning,
    this.status = MessageStatus.done,
    this.excludeFromContext = false,
    this.error,
    this.errorCode,
    this.errorRequestId,
    this.webSearch = false,
    this.files = const [],
    this.sources = const [],
    required this.createdAt,
    this.parentId,
    this.selectedChildId,
    this.enc,
    this.encReasoning,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'conversationId': conversationId,
    'role': role.name,
    'content': content,
    'reasoning': reasoning,
    'status': status.name,
    'excludeFromContext': excludeFromContext,
    'error': error,
    'errorCode': errorCode,
    'errorRequestId': errorRequestId,
    'webSearch': webSearch,
    'files': files,
    'sources': sources,
    'createdAt': createdAt.millisecondsSinceEpoch,
    'parentId': parentId,
    'selectedChildId': selectedChildId,
    'enc': enc,
    'encReasoning': encReasoning,
  };

  factory Message.fromJson(Map<String, dynamic> json) => Message(
    id: json['id'] as String,
    conversationId: json['conversationId'] as String? ?? '',
    role: _roleFrom(json['role']),
    content: json['content'] as String? ?? '',
    reasoning: json['reasoning'] as String?,
    status: _statusFrom(json['status']),
    excludeFromContext: json['excludeFromContext'] == true,
    error: json['error'] as String?,
    errorCode: json['errorCode'] as String?,
    errorRequestId: json['errorRequestId'] as String?,
    webSearch: json['webSearch'] == true,
    files: _stringListFromJson(json['files']),
    sources: _sourceListFromJson(json['sources']),
    createdAt: _dateFromJson(json['createdAt']),
    parentId: json['parentId'] as String?,
    selectedChildId: json['selectedChildId'] as String?,
    enc: json['enc'] as String?,
    encReasoning: json['encReasoning'] as String?,
  );

  Message copyWith({
    String? id,
    String? conversationId,
    ChatRole? role,
    String? content,
    String? reasoning,
    MessageStatus? status,
    bool? excludeFromContext,
    String? error,
    String? errorCode,
    String? errorRequestId,
    bool? webSearch,
    List<String>? files,
    List<Map<String, dynamic>>? sources,
    DateTime? createdAt,
    String? parentId,
    String? selectedChildId,
    String? enc,
    String? encReasoning,
  }) => Message(
    id: id ?? this.id,
    conversationId: conversationId ?? this.conversationId,
    role: role ?? this.role,
    content: content ?? this.content,
    reasoning: reasoning ?? this.reasoning,
    status: status ?? this.status,
    excludeFromContext: excludeFromContext ?? this.excludeFromContext,
    error: error ?? this.error,
    errorCode: errorCode ?? this.errorCode,
    errorRequestId: errorRequestId ?? this.errorRequestId,
    webSearch: webSearch ?? this.webSearch,
    files: files ?? this.files,
    sources: sources ?? this.sources,
    createdAt: createdAt ?? this.createdAt,
    parentId: parentId ?? this.parentId,
    selectedChildId: selectedChildId ?? this.selectedChildId,
    enc: enc ?? this.enc,
    encReasoning: encReasoning ?? this.encReasoning,
  );
}

ChatRole _roleFrom(dynamic value) {
  for (final role in ChatRole.values) {
    if (role.name == value) return role;
  }
  return ChatRole.user;
}

MessageStatus _statusFrom(dynamic value) {
  for (final status in MessageStatus.values) {
    if (status.name == value) return status;
  }
  return MessageStatus.done;
}

class Tombstone {
  final String id;
  final DateTime deletedAt;

  const Tombstone({required this.id, required this.deletedAt});

  Map<String, dynamic> toJson() => {
    'id': id,
    'deletedAt': deletedAt.millisecondsSinceEpoch,
  };

  factory Tombstone.fromJson(Map<String, dynamic> json) => Tombstone(
    id: json['id'] as String,
    deletedAt: _dateFromJson(json['deletedAt']),
  );
}

class PromptSuggestion {
  final String title;
  final String subtitle;
  final String fill;

  const PromptSuggestion({
    required this.title,
    required this.subtitle,
    required this.fill,
  });
}

class FileAttachment {
  final String id;
  final String name;
  final int bytes;
  final int chars;
  final DateTime createdAt;
  final String? preview;

  const FileAttachment({
    required this.id,
    required this.name,
    required this.bytes,
    required this.chars,
    required this.createdAt,
    this.preview,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'bytes': bytes,
    'chars': chars,
    'createdAt': createdAt.millisecondsSinceEpoch,
    'preview': preview,
  };

  factory FileAttachment.fromJson(Map<String, dynamic> json) => FileAttachment(
    id: json['id'] as String,
    name: json['name'] as String? ?? '',
    bytes: json['bytes'] as int? ?? 0,
    chars: json['chars'] as int? ?? 0,
    createdAt: _dateFromJson(json['createdAt']),
    preview: json['preview'] as String?,
  );
}

class AuthUser {
  final String id;
  final String username;
  final String? displayName;
  final DateTime createdAt;
  final String? customerNo;
  final bool isAdmin;

  const AuthUser({
    required this.id,
    required this.username,
    this.displayName,
    required this.createdAt,
    this.customerNo,
    this.isAdmin = false,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'username': username,
    'displayName': displayName,
    'createdAt': createdAt.millisecondsSinceEpoch,
    'customerNo': customerNo,
    'isAdmin': isAdmin,
  };

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
    id: json['id'] as String,
    username: json['username'] as String? ?? '',
    displayName: json['displayName'] as String?,
    createdAt: _dateFromJson(json['createdAt']),
    customerNo: json['customerNo'] as String?,
    isAdmin: json['isAdmin'] == true,
  );
}

class AuthResult {
  final String token;
  final AuthUser user;

  const AuthResult({required this.token, required this.user});

  Map<String, dynamic> toJson() => {'token': token, 'user': user.toJson()};

  factory AuthResult.fromJson(Map<String, dynamic> json) => AuthResult(
    token: json['token'] as String? ?? '',
    user: AuthUser.fromJson(Map<String, dynamic>.from(json['user'] as Map)),
  );
}

/// 服务端公告（公开接口，登录后展示一次）。
class Announcement {
  final String id;
  final String title;
  final String body;
  final DateTime? updatedAt;

  const Announcement({
    required this.id,
    required this.title,
    required this.body,
    this.updatedAt,
  });

  factory Announcement.fromJson(Map<String, dynamic> json) => Announcement(
    id: json['id']?.toString() ?? '',
    title: json['title']?.toString() ?? '',
    body: json['body']?.toString() ?? '',
    updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? ''),
  );
}
