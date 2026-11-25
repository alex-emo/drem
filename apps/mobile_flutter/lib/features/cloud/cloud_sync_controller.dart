/// 云备份同步：对齐 web `cloudSync.ts` 的 dream-backup v2 格式、AES-GCM 加密、
/// mergeBackup 合并语义与防抖/节流触发。
///
/// 构造参数名按契约固定为 `api/repo/crypto/session`（公开 API），
/// 故无法改用 `this._api` 初始化形参，屏蔽 prefer_initializing_formals。
library;

// ignore_for_file: prefer_initializing_formals

import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/models.dart';
import '../../data/chat_repository.dart';
import '../../services/api_client.dart';
import '../../services/crypto_service.dart';
import '../../services/session_store.dart';

/// 云端备份加密后上限（字节）。
const int maxBackupBytes = 20 * 1024 * 1024;

/// 两次自动推送之间的最短间隔（毫秒）。
const int pushThrottleMs = 5 * 60 * 1000;

const String _backupRevKey = 'dream-backup-rev';
const String _lastPushKey = 'dream-cloud-last-push';

class CloudSyncException implements Exception {
  CloudSyncException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// 合并决策结果：哪些会话/消息要写库、哪些会话要删除、哪些墓碑要更新。
class BackupMergeResult {
  const BackupMergeResult({
    required this.conversations,
    required this.messages,
    required this.tombstones,
    required this.deleteConversationIds,
  });

  final List<Conversation> conversations;
  final List<Message> messages;
  final List<Tombstone> tombstones;
  final Set<String> deleteConversationIds;
}

/// 节流判断（纯函数，供 maybePush 使用）。
///
/// `rev` = 最近一次写库时间戳（`dream-backup-rev`），
/// `lastPush` = 最近一次成功推送时间戳（`dream-cloud-last-push`），
/// `now` = 当前时间（注入 clock）。
/// 无脏数据（rev<=0 或 rev<=lastPush）或距上次推送 <5min 时返回 false。
bool shouldPushNow({
  required int rev,
  required int lastPush,
  required int now,
}) {
  if (rev <= 0 || rev <= lastPush) return false;
  if (now - lastPush < pushThrottleMs) return false;
  return true;
}

/// 把本地数据序列化为 dream-backup v2（云端/导出共用）。
Map<String, dynamic> buildBackupJson({
  required DateTime exportedAt,
  required List<Conversation> conversations,
  required List<Message> messages,
  required List<Tombstone> tombstones,
  List<Map<String, dynamic>>? sessions,
}) {
  return {
    'format': 'dream-backup',
    'version': 2,
    'exportedAt': exportedAt.toIso8601String(),
    'conversations': conversations.map((c) => c.toJson()).toList(),
    'messages': messages.map((m) => m.toJson()).toList(),
    'tombstones': tombstones.map((t) => t.toJson()).toList(),
    if (sessions != null && sessions.isNotEmpty) 'sessions': sessions,
  };
}

/// 纯函数：按 web `mergeBackup` 语义计算合并结果。
///
/// 语义：
/// - 墓碑：保留 deletedAt 更大者；本地会话更新晚于墓碑删除时间则墓碑不生效。
/// - 会话：云端会话在墓碑删除时间之后（updatedAt 更新）且（本地无或云端更新）才写入。
/// - 消息：会话必须在云端；墓碑删除时间 < createdAt 才保留；本地无此 id，
///   或 createdAt >= 本地且内容不同才覆盖。
BackupMergeResult computeMerge({
  required List<Conversation> localConversations,
  required List<Message> localMessages,
  required List<Tombstone> localTombstones,
  required Map<String, dynamic> backup,
}) {
  final localConvMap = {for (final c in localConversations) c.id: c};
  final localMsgMap = {for (final m in localMessages) m.id: m};
  final tombstones = {for (final t in localTombstones) t.id: t};

  for (final incoming in _parseTombstones(backup['tombstones'])) {
    final current = tombstones[incoming.id];
    if (current == null || incoming.deletedAt.isAfter(current.deletedAt)) {
      tombstones[incoming.id] = incoming;
    }
  }

  final deletedUntil = <String, DateTime>{};
  for (final tombstone in tombstones.values) {
    final local = localConvMap[tombstone.id];
    if (local == null || !local.updatedAt.isAfter(tombstone.deletedAt)) {
      deletedUntil[tombstone.id] = tombstone.deletedAt;
    }
  }

  final incomingConvs = _parseConversations(backup['conversations']);
  final incomingMsgs = _parseMessages(backup['messages']);
  final convIds = incomingConvs.map((c) => c.id).toSet();

  final conversations = <Conversation>[];
  final messages = <Message>[];
  for (final incoming in incomingConvs) {
    final deletedAt = deletedUntil[incoming.id];
    if (deletedAt != null && !incoming.updatedAt.isAfter(deletedAt)) continue;
    final local = localConvMap[incoming.id];
    if (local == null || incoming.updatedAt.isAfter(local.updatedAt)) {
      conversations.add(incoming);
    }
  }
  for (final incoming in incomingMsgs) {
    if (!convIds.contains(incoming.conversationId)) continue;
    final deletedAt = deletedUntil[incoming.conversationId];
    if (deletedAt != null && !incoming.createdAt.isAfter(deletedAt)) continue;
    final local = localMsgMap[incoming.id];
    if (local == null) {
      messages.add(incoming);
    } else if (!incoming.createdAt.isBefore(local.createdAt) &&
        incoming.content != local.content) {
      messages.add(incoming);
    }
  }

  final deleteIds = deletedUntil.keys
      .where((id) => localConvMap.containsKey(id))
      .toSet();

  return BackupMergeResult(
    conversations: conversations,
    messages: messages,
    tombstones: tombstones.values.toList(),
    deleteConversationIds: deleteIds,
  );
}

class CloudSyncController extends ChangeNotifier {
  CloudSyncController({
    required ApiClient api,
    required ChatRepository repo,
    required CryptoService crypto,
    required SessionStore session,
    DateTime Function()? clock,
  }) : _api = api,
       _repo = repo,
       _crypto = crypto,
       _session = session,
       _clock = clock ?? DateTime.now;

  final ApiClient _api;
  final ChatRepository _repo;
  final CryptoService _crypto;
  final SessionStore _session;
  final DateTime Function() _clock;

  String? _lastError;

  /// 最近一次同步错误文案；成功同步后清空。供设置页/控制台展示。
  String? get lastError => _lastError;

  /// 登录后：取服务端密钥 → 存 sessionKey → （如需要）legacyKey 迁移 → 拉取合并。
  Future<void> unlock() async {
    final meta = await _api.getBackupMeta();
    final key = meta['key'] as String?;
    if (key == null || key.isEmpty) {
      throw CloudSyncException('云端备份缺少密钥');
    }
    final legacyKey = meta['legacyKey'] as String?;
    final storedKey = await _session.getSessionKey();

    final needsMigration = legacyKey != null && storedKey != key;
    if (needsMigration) {
      // 本地数据曾用 legacyKey 加密：先以旧密钥解密迁移，再切到新密钥推送。
      await _session.setSessionKey(legacyKey);
      try {
        await pullAndMerge();
      } finally {
        await _session.setSessionKey(key);
      }
      try {
        await push();
      } catch (_) {
        // 下次登录继续覆盖旧备份。
      }
    } else {
      await _session.setSessionKey(key);
      await pullAndMerge();
    }
    await _session.setSessionKey(key);
  }

  /// 全量推送：gzip(AES-GCM(json)) → PUT /backup/stream。
  Future<void> push() async {
    final key = await _session.getSessionKey();
    if (key == null || key.isEmpty) return;

    final conversations = await _repo.listConversations();
    final messages = await _repo.getAllMessages();
    final tombstones = await _repo.listTombstones();

    final json = jsonEncode(
      buildBackupJson(
        exportedAt: _clock(),
        conversations: conversations,
        messages: messages,
        tombstones: tombstones,
      ),
    );
    final rawBytes = utf8.encode(json);
    if (rawBytes.length > maxBackupBytes) {
      throw CloudSyncException(
        '云端备份内容约 ${(rawBytes.length / 1024 / 1024).toStringAsFixed(1)} MB，'
        '超过 20 MB 上限；请清理较早会话或手动导出。',
      );
    }

    final compressed = await _crypto.gzipBytes(Uint8List.fromList(rawBytes));
    final iv = _randomIv(12);
    final cipher = await _crypto.encryptBytes(compressed, key, iv);
    if (cipher.length > maxBackupBytes) {
      throw CloudSyncException(
        '云端备份加密后约 ${(cipher.length / 1024 / 1024).toStringAsFixed(1)} MB，'
        '超过服务端 20 MB 上限；请手动导出并清理较早会话。',
      );
    }

    try {
      await _api.putBackupStream(cipher, ivB64: base64Encode(iv));
      _lastError = null;
      notifyListeners();
    } catch (error) {
      _lastError = error.toString();
      notifyListeners();
      rethrow;
    }
  }

  /// 拉取云端备份并合并（无备份则直接返回）。
  Future<void> pullAndMerge() async {
    final meta = await _api.getBackupMeta();
    if (meta['backup'] == null) return;
    final bytes = await _readBackupBytes(meta);
    final json = await _crypto.ungzipBytes(bytes);
    final decoded = jsonDecode(utf8.decode(json));
    if (decoded is! Map) {
      throw CloudSyncException('云端备份格式不正确');
    }
    await mergeBackup(Map<String, dynamic>.from(decoded));
  }

  /// 把已解密的 dream-backup v2 数据合并进本地库。
  Future<({int conversations, int messages})> mergeBackup(
    Map<String, dynamic> backup,
  ) async {
    final result = computeMerge(
      localConversations: await _repo.listConversations(),
      localMessages: await _repo.getAllMessages(),
      localTombstones: await _repo.listTombstones(),
      backup: backup,
    );
    for (final id in result.deleteConversationIds) {
      await _repo.deleteConversationData(id);
    }
    for (final tombstone in result.tombstones) {
      await _repo.putTombstone(tombstone);
    }
    if (result.conversations.isNotEmpty) {
      await _repo.putConversations(result.conversations);
    }
    if (result.messages.isNotEmpty) {
      await _repo.putMessages(result.messages);
    }
    notifyListeners();
    return (
      conversations: result.conversations.length,
      messages: result.messages.length,
    );
  }

  /// 标记本地数据已变更（写 `dream-backup-rev=now`），供防抖触发。
  Future<void> markDirty() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_backupRevKey, _clock().millisecondsSinceEpoch);
  }

  /// 节流推送：无脏数据或距上次推送 <5min 则跳过；成功写 `dream-cloud-last-push`。
  Future<void> maybePush() async {
    final key = await _session.getSessionKey();
    if (key == null || key.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    final rev = prefs.getInt(_backupRevKey) ?? 0;
    final last = prefs.getInt(_lastPushKey) ?? 0;
    final now = _clock().millisecondsSinceEpoch;
    if (!shouldPushNow(rev: rev, lastPush: last, now: now)) return;
    try {
      await push();
      await prefs.setInt(_lastPushKey, now);
    } catch (_) {
      rethrow;
    }
  }

  /// 生成 dream-export v1 信封字节（不落盘，供导出用）。
  Future<Uint8List> buildExportBytes() async {
    final key = await _session.getSessionKey();
    if (key == null || key.isEmpty) {
      throw CloudSyncException('未解锁云同步，无法导出');
    }
    final conversations = await _repo.listConversations();
    final messages = await _repo.getAllMessages();
    final tombstones = await _repo.listTombstones();
    final json = jsonEncode(
      buildBackupJson(
        exportedAt: _clock(),
        conversations: conversations,
        messages: messages,
        tombstones: tombstones,
      ),
    );
    final compressed = await _crypto.gzipBytes(
      Uint8List.fromList(utf8.encode(json)),
    );
    final iv = _randomIv(12);
    final cipher = await _crypto.encryptBytes(compressed, key, iv);
    final envelope = <String, dynamic>{
      'format': 'dream-export',
      'version': 1,
      'exportedAt': _clock().toIso8601String(),
      'encrypted': true,
      'algorithm': 'AES-GCM',
      'compression': 'gzip',
      'iv': base64Encode(iv),
      'data': base64Encode(cipher),
    };
    return Uint8List.fromList(utf8.encode(jsonEncode(envelope)));
  }

  /// 用 file_picker 让用户选择保存位置并写出 dream-export v1 文件。
  Future<void> exportToFile() async {
    final bytes = await buildExportBytes();
    final stamp = _clock().millisecondsSinceEpoch;
    await FilePicker.saveFile(
      fileName: 'dream-backup-$stamp.dream',
      bytes: bytes,
      dialogTitle: '导出备份',
    );
    notifyListeners();
  }

  /// 从本地文件恢复：解析 .dream / .json / .gz → 合并进本地库。
  Future<void> importFromFile(String path) async {
    final bytes = Uint8List.fromList(await File(path).readAsBytes());
    final backup = await decodeImportBytes(
      bytes: bytes,
      filename: path,
      sessionKey: await _session.getSessionKey(),
      crypto: _crypto,
    );
    await mergeBackup(backup);
  }

  /// 清空本地数据（会话/消息/墓碑）。
  ///
  /// 调用方必须先做二次确认。
  Future<void> clearLocalData() async {
    await _repo.clearAll();
    notifyListeners();
  }

  Future<Uint8List> _readBackupBytes(Map<String, dynamic> meta) async {
    final key = await _session.getSessionKey();
    if (key == null || key.isEmpty) {
      throw CloudSyncException('未解锁云同步');
    }
    final backup = meta['backup'];
    if (backup is! Map) {
      throw CloudSyncException('云端备份格式不正确');
    }
    final payload = backup['payload'];
    if (payload is String && payload.isNotEmpty) {
      if (backup['legacy'] == true) {
        final legacyKey = meta['legacyKey'] as String?;
        if (legacyKey == null) {
          throw CloudSyncException('旧版云端备份缺少 legacyKey');
        }
        final clear = await _crypto.decryptText(payload, legacyKey);
        if (clear == null) {
          throw CloudSyncException('旧版云端备份解密失败');
        }
        return Uint8List.fromList(utf8.encode(clear));
      }
      final parts = payload.split('.');
      if (parts.length != 3 || parts[0] != 'dream1') {
        throw CloudSyncException('云端备份格式不正确');
      }
      final iv = base64Decode(parts[1]);
      final data = base64Decode(parts[2]);
      return _crypto.decryptBytes(
        Uint8List.fromList(data),
        key,
        Uint8List.fromList(iv),
      );
    }
    final stream = await _api.getBackupStream();
    final ivB64 = stream.ivB64;
    if (ivB64 == null) {
      throw CloudSyncException('云端备份缺少 IV');
    }
    return _crypto.decryptBytes(
      stream.body,
      key,
      Uint8List.fromList(base64Decode(ivB64)),
    );
  }
}

/// 解析导入文件（.dream / .json / .gz）为 dream-backup v2 map，供测试复用。
Future<Map<String, dynamic>> decodeImportBytes({
  required Uint8List bytes,
  required String filename,
  required String? sessionKey,
  required CryptoService crypto,
}) async {
  final lower = filename.toLowerCase();
  if (lower.endsWith('.dream')) {
    final envelope = jsonDecode(utf8.decode(bytes));
    if (envelope is! Map) {
      throw CloudSyncException('导出文件格式不正确');
    }
    final map = Map<String, dynamic>.from(envelope);
    final iv = map['iv'] as String?;
    final data = map['data'] as String?;
    if (iv == null || data == null) {
      throw CloudSyncException('导出文件缺少密文');
    }
    if (sessionKey == null || sessionKey.isEmpty) {
      throw CloudSyncException('未解锁云同步，无法导入加密备份');
    }
    final clear = await crypto.decryptBytes(
      Uint8List.fromList(base64Decode(data)),
      sessionKey,
      Uint8List.fromList(base64Decode(iv)),
    );
    final unzipped = await crypto.ungzipBytes(clear);
    final decoded = jsonDecode(utf8.decode(unzipped));
    if (decoded is! Map) {
      throw CloudSyncException('导出文件内容不正确');
    }
    return Map<String, dynamic>.from(decoded);
  }

  final Uint8List jsonBytes;
  if (lower.endsWith('.gz')) {
    jsonBytes = await crypto.ungzipBytes(bytes);
  } else {
    jsonBytes = bytes;
  }
  final decoded = jsonDecode(utf8.decode(jsonBytes));
  if (decoded is! Map) {
    throw CloudSyncException('导入文件内容不正确');
  }
  return Map<String, dynamic>.from(decoded);
}

List<Conversation> _parseConversations(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((e) => Conversation.fromJson(Map<String, dynamic>.from(e)))
      .toList();
}

List<Message> _parseMessages(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((e) => Message.fromJson(Map<String, dynamic>.from(e)))
      .toList();
}

List<Tombstone> _parseTombstones(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((e) => Tombstone.fromJson(Map<String, dynamic>.from(e)))
      .toList();
}

Uint8List _randomIv(int length) {
  final random = Random.secure();
  return Uint8List.fromList(List.generate(length, (_) => random.nextInt(256)));
}
