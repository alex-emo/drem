/// 本地仓库：会话/消息/墓碑的明文读写与字段透传，加密由调用方处理。
library;

import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../core/models.dart';
import 'db.dart';

class ChatRepository {
  final Database _db;

  ChatRepository(this._db);

  static Future<ChatRepository> open() async =>
      ChatRepository(await openDreamDatabase());

  Future<List<Conversation>> listConversations() async {
    final rows = await _db.query('conversations', orderBy: 'updatedAt DESC');
    return rows.map(_conversationFromRow).toList();
  }

  Future<Conversation?> getConversation(String id) async {
    final rows = await _db.query(
      'conversations',
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return _conversationFromRow(rows.first);
  }

  Future<void> putConversation(Conversation conversation) async {
    await _db.insert(
      'conversations',
      _conversationToRow(conversation),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> putConversations(List<Conversation> conversations) async {
    await _db.transaction((txn) async {
      for (final conversation in conversations) {
        await txn.insert(
          'conversations',
          _conversationToRow(conversation),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }

  /// 单事务：删会话 + 删其消息 + 写 tombstone(id, now)。
  Future<void> deleteConversationData(String id) async {
    await _db.transaction((txn) async {
      await txn.delete('conversations', where: 'id = ?', whereArgs: [id]);
      await txn.delete(
        'messages',
        where: 'conversationId = ?',
        whereArgs: [id],
      );
      await txn.insert('tombstones', {
        'id': id,
        'deletedAt': DateTime.now().millisecondsSinceEpoch,
      });
    });
  }

  Future<List<Message>> getMessages(String conversationId) async {
    final rows = await _db.query(
      'messages',
      where: 'conversationId = ?',
      whereArgs: [conversationId],
      orderBy: 'createdAt ASC',
    );
    return rows.map(_messageFromRow).whereType<Message>().toList();
  }

  Future<List<Message>> getAllMessages() async {
    final rows = await _db.query('messages', orderBy: 'createdAt ASC');
    return rows.map(_messageFromRow).whereType<Message>().toList();
  }

  Future<void> putMessage(Message message) async {
    await _db.insert(
      'messages',
      _messageToRow(message),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> putMessages(List<Message> messages) async {
    await _db.transaction((txn) async {
      for (final message in messages) {
        await txn.insert(
          'messages',
          _messageToRow(message),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }

  Future<void> putTombstone(Tombstone tombstone) async {
    await _db.insert('tombstones', {
      'id': tombstone.id,
      'deletedAt': tombstone.deletedAt.millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<Tombstone>> listTombstones() async {
    final rows = await _db.query('tombstones');
    return rows
        .map(
          (r) => Tombstone(
            id: r['id'] as String,
            deletedAt: DateTime.fromMillisecondsSinceEpoch(
              r['deletedAt'] as int,
            ),
          ),
        )
        .toList();
  }

  Future<void> deleteTombstone(String id) async {
    await _db.delete('tombstones', where: 'id = ?', whereArgs: [id]);
  }

  /// 清空全部本地聊天数据（会话/消息/墓碑）。调用方必须先二次确认。
  Future<void> clearAll() async {
    await _db.transaction((txn) async {
      await txn.delete('messages');
      await txn.delete('conversations');
      await txn.delete('tombstones');
    });
  }
}

Conversation _conversationFromRow(Map<String, Object?> row) => Conversation(
  id: row['id'] as String,
  title: row['title'] as String? ?? '',
  createdAt: DateTime.fromMillisecondsSinceEpoch(row['createdAt'] as int),
  updatedAt: DateTime.fromMillisecondsSinceEpoch(row['updatedAt'] as int),
  rootMessageId: row['rootMessageId'] as String?,
  encTitle: row['encTitle'] as String?,
);

Map<String, Object?> _conversationToRow(Conversation c) => {
  'id': c.id,
  'title': c.title,
  'createdAt': c.createdAt.millisecondsSinceEpoch,
  'updatedAt': c.updatedAt.millisecondsSinceEpoch,
  'rootMessageId': c.rootMessageId,
  'encTitle': c.encTitle,
};

/// 坏 JSON（files/sources）记录跳过不抛，返回 null。
Message? _messageFromRow(Map<String, Object?> row) {
  List<String> files;
  List<Map<String, dynamic>> sources;
  try {
    files = _decodeStringList(row['files'] as String?);
    sources = _decodeSourceList(row['sources'] as String?);
  } catch (_) {
    return null;
  }
  return Message(
    id: row['id'] as String,
    conversationId: row['conversationId'] as String? ?? '',
    role: _roleFromName(row['role'] as String?),
    content: row['content'] as String? ?? '',
    reasoning: row['reasoning'] as String?,
    status: _statusFromName(row['status'] as String?),
    excludeFromContext: (row['excludeFromContext'] as int? ?? 0) != 0,
    error: row['error'] as String?,
    errorCode: row['errorCode'] as String?,
    errorRequestId: row['errorRequestId'] as String?,
    webSearch: (row['webSearch'] as int? ?? 0) != 0,
    files: files,
    sources: sources,
    createdAt: DateTime.fromMillisecondsSinceEpoch(row['createdAt'] as int),
    parentId: row['parentId'] as String?,
    selectedChildId: row['selectedChildId'] as String?,
    enc: row['enc'] as String?,
    encReasoning: row['encReasoning'] as String?,
  );
}

Map<String, Object?> _messageToRow(Message m) => {
  'id': m.id,
  'conversationId': m.conversationId,
  'role': m.role.name,
  'content': m.content,
  'reasoning': m.reasoning,
  'status': m.status.name,
  'excludeFromContext': m.excludeFromContext ? 1 : 0,
  'error': m.error,
  'errorCode': m.errorCode,
  'errorRequestId': m.errorRequestId,
  'webSearch': m.webSearch ? 1 : 0,
  'files': jsonEncode(m.files),
  'sources': jsonEncode(m.sources),
  'createdAt': m.createdAt.millisecondsSinceEpoch,
  'parentId': m.parentId,
  'selectedChildId': m.selectedChildId,
  'enc': m.enc,
  'encReasoning': m.encReasoning,
};

List<String> _decodeStringList(String? raw) {
  if (raw == null || raw.isEmpty) return const [];
  final decoded = jsonDecode(raw);
  if (decoded is! List) return const [];
  return decoded.map((e) => e.toString()).toList();
}

List<Map<String, dynamic>> _decodeSourceList(String? raw) {
  if (raw == null || raw.isEmpty) return const [];
  final decoded = jsonDecode(raw);
  if (decoded is! List) return const [];
  return decoded
      .whereType<Map>()
      .map((e) => Map<String, dynamic>.from(e))
      .toList();
}

ChatRole _roleFromName(String? name) {
  for (final role in ChatRole.values) {
    if (role.name == name) return role;
  }
  return ChatRole.user;
}

MessageStatus _statusFromName(String? name) {
  for (final status in MessageStatus.values) {
    if (status.name == name) return status;
  }
  return MessageStatus.done;
}
