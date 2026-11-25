/// 云同步 + 导入 + 更新的纯函数/内存单测（不写网络、不落盘）。
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:dream/core/models.dart';
import 'package:dream/features/cloud/cloud_sync_controller.dart';
import 'package:dream/features/import/archive_import_controller.dart';
import 'package:dream/features/import/share_import_controller.dart';
import 'package:dream/features/update/update_controller.dart';
import 'package:dream/services/crypto_service.dart';
import 'package:flutter_test/flutter_test.dart';

const _crypto = CryptoService();
const _sessionKey = 'unit-test-session-key';

DateTime _t(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);

Conversation _conv(String id, int updatedAt) => Conversation(
  id: id,
  title: 't-$id',
  createdAt: _t(0),
  updatedAt: _t(updatedAt),
);

Message _msg(
  String id,
  String convId,
  String content,
  int createdAt, {
  ChatRole role = ChatRole.user,
}) => Message(
  id: id,
  conversationId: convId,
  role: role,
  content: content,
  createdAt: _t(createdAt),
);

Map<String, dynamic> _backup({
  List<Conversation> conversations = const [],
  List<Message> messages = const [],
  List<Tombstone> tombstones = const [],
}) => buildBackupJson(
  exportedAt: _t(0),
  conversations: conversations,
  messages: messages,
  tombstones: tombstones,
);

void main() {
  group('backup v2 序列化 → 加密 → 解密往返', () {
    test('经 gzip + AES-GCM 后完整还原', () async {
      final convs = [_conv('c1', 100), _conv('c2', 200)];
      final msgs = [
        _msg('m1', 'c1', 'hello', 10),
        _msg('m2', 'c1', 'world', 20, role: ChatRole.assistant),
      ];
      final tombstones = [Tombstone(id: 'c3', deletedAt: _t(300))];

      final json = jsonEncode(
        _backup(conversations: convs, messages: msgs, tombstones: tombstones),
      );
      final compressed = await _crypto.gzipBytes(
        Uint8List.fromList(utf8.encode(json)),
      );
      final iv = Uint8List.fromList(List<int>.generate(12, (i) => i));
      final cipher = await _crypto.encryptBytes(compressed, _sessionKey, iv);
      final clear = await _crypto.decryptBytes(cipher, _sessionKey, iv);
      final unzipped = await _crypto.ungzipBytes(clear);

      final decoded = jsonDecode(utf8.decode(unzipped)) as Map<String, dynamic>;
      expect(decoded['format'], 'dream-backup');
      expect(decoded['version'], 2);
      expect((decoded['conversations'] as List).length, 2);
      expect((decoded['tombstones'] as List).length, 1);
      final msgsOut = (decoded['messages'] as List)
          .cast<Map<String, dynamic>>();
      expect(msgsOut.firstWhere((m) => m['id'] == 'm2')['content'], 'world');
    });
  });

  group('computeMerge 合并语义', () {
    test('墓碑取 deletedAt 更大者', () {
      final result = computeMerge(
        localConversations: const [],
        localMessages: const [],
        localTombstones: [Tombstone(id: 'c1', deletedAt: _t(100))],
        backup: _backup(
          tombstones: [Tombstone(id: 'c1', deletedAt: _t(200))],
        ),
      );
      expect(result.tombstones, hasLength(1));
      expect(result.tombstones.single.deletedAt, _t(200));
    });

    test('云端墓碑删除本地会话（本地 updatedAt 不晚于墓碑时间）', () {
      final result = computeMerge(
        localConversations: [_conv('c1', 100)],
        localMessages: const [],
        localTombstones: const [],
        backup: _backup(
          tombstones: [Tombstone(id: 'c1', deletedAt: _t(200))],
        ),
      );
      expect(result.deleteConversationIds, contains('c1'));
    });

    test('本地会话更新晚于墓碑时间则保留（墓碑不生效）', () {
      final result = computeMerge(
        localConversations: [_conv('c1', 300)],
        localMessages: const [],
        localTombstones: const [],
        backup: _backup(
          tombstones: [Tombstone(id: 'c1', deletedAt: _t(200))],
        ),
      );
      expect(result.deleteConversationIds, isEmpty);
    });

    test('会话：云端 updatedAt 新者胜', () {
      final result = computeMerge(
        localConversations: [_conv('c1', 100)],
        localMessages: const [],
        localTombstones: const [],
        backup: _backup(conversations: [_conv('c1', 200)]),
      );
      expect(result.conversations.map((c) => c.id), contains('c1'));
      expect(result.conversations.single.updatedAt, _t(200));
    });

    test('会话：云端更旧则忽略', () {
      final result = computeMerge(
        localConversations: [_conv('c1', 200)],
        localMessages: const [],
        localTombstones: const [],
        backup: _backup(conversations: [_conv('c1', 100)]),
      );
      expect(result.conversations, isEmpty);
    });

    test('消息：会话不在云端则忽略', () {
      final result = computeMerge(
        localConversations: const [],
        localMessages: const [],
        localTombstones: const [],
        backup: _backup(messages: [_msg('m1', 'cX', 'hi', 10)]),
      );
      expect(result.messages, isEmpty);
    });

    test('消息：本地无此 id 则写入', () {
      final result = computeMerge(
        localConversations: [_conv('c1', 100)],
        localMessages: const [],
        localTombstones: const [],
        backup: _backup(
          conversations: [_conv('c1', 100)],
          messages: [_msg('m1', 'c1', 'hi', 10)],
        ),
      );
      expect(result.messages.map((m) => m.id), contains('m1'));
    });

    test('消息：createdAt>=本地且内容不同才覆盖', () {
      final result = computeMerge(
        localConversations: [_conv('c1', 100)],
        localMessages: [_msg('m1', 'c1', 'old', 10)],
        localTombstones: const [],
        backup: _backup(
          conversations: [_conv('c1', 100)],
          messages: [_msg('m1', 'c1', 'new', 15)],
        ),
      );
      expect(result.messages.single.content, 'new');
    });

    test('消息：内容相同不覆盖', () {
      final result = computeMerge(
        localConversations: [_conv('c1', 100)],
        localMessages: [_msg('m1', 'c1', 'same', 10)],
        localTombstones: const [],
        backup: _backup(
          conversations: [_conv('c1', 100)],
          messages: [_msg('m1', 'c1', 'same', 15)],
        ),
      );
      expect(result.messages, isEmpty);
    });

    test('消息：云端 createdAt 更旧不覆盖', () {
      final result = computeMerge(
        localConversations: [_conv('c1', 100)],
        localMessages: [_msg('m1', 'c1', 'old', 20)],
        localTombstones: const [],
        backup: _backup(
          conversations: [_conv('c1', 100)],
          messages: [_msg('m1', 'c1', 'new', 10)],
        ),
      );
      expect(result.messages, isEmpty);
    });
  });

  group('shouldPushNow 节流', () {
    test('无脏数据不推', () {
      expect(shouldPushNow(rev: 0, lastPush: 0, now: 1000), isFalse);
    });

    test('rev 不晚于上次推送不推', () {
      expect(shouldPushNow(rev: 100, lastPush: 200, now: 1000), isFalse);
    });

    test('5 分钟内不推', () {
      const last = 100000;
      expect(
        shouldPushNow(rev: 200000, lastPush: last, now: last + 299999),
        isFalse,
      );
    });

    test('超过 5 分钟推', () {
      const last = 100000;
      expect(
        shouldPushNow(rev: 200000, lastPush: last, now: last + 300000),
        isTrue,
      );
    });
  });

  group('分享 id 生成', () {
    test('会话/消息 id 与 idx 递增', () {
      expect(shareConversationId('abc'), 'ds-share-abc');
      expect(shareMessageId('abc', 0), 'ds-share-abc-1');
      expect(shareMessageId('abc', 1), 'ds-share-abc-2');
    });

    test('convertShare：reasoning→thinking，status error 保留', () {
      final result = convertShare(
        shareId: 'abc',
        now: _t(0),
        data: {
          'shareId': 'abc',
          'title': '分享标题',
          'messages': [
            {'role': 'user', 'content': '你好', 'createdAt': 100},
            {
              'role': 'assistant',
              'content': '回复',
              'reasoning': '思考中',
              'status': 'error',
              'createdAt': 200,
            },
          ],
        },
      );
      expect(result.conversation.id, 'ds-share-abc');
      expect(result.conversation.title, '分享标题');
      expect(result.messages, hasLength(2));
      expect(result.messages[0].id, 'ds-share-abc-1');
      expect(result.messages[1].id, 'ds-share-abc-2');
      expect(result.messages[1].reasoning, '思考中');
      expect(result.messages[1].status, MessageStatus.error);
    });
  });

  group('archive manifest v3 回溯与 fragment 映射', () {
    test('current_message_id 回溯得到时间顺序分支', () {
      final messages = [
        {'id': 1, 'parent_id': null},
        {'id': 2, 'parent_id': 1},
        {'id': 3, 'parent_id': 2},
        {'id': 4, 'parent_id': 2}, // 侧枝
      ];
      final branch = currentArchiveBranch(
        messages.cast<Map<String, dynamic>>(),
        3,
      );
      expect(branch.map((m) => m['id']), [1, 2, 3]);
    });

    test('convertArchiveSession 映射 role/reasoning/files/error', () {
      final result = convertArchiveSession({
        'id': 's1',
        'title': '',
        'current_message_id': 2,
        'inserted_at': '2024-01-01T00:00:00.000Z',
        'updated_at': '2024-01-01T00:00:00.000Z',
        'messages': [
          {
            'id': 1,
            'parent_id': null,
            'role': 'USER',
            'status': 'DONE',
            'inserted_at': '2024-01-01T00:00:01.000Z',
            'fragments': [
              {'type': 'REQUEST', 'content': '读这个'},
              {
                'type': 'FILE',
                'files': ['a.pdf'],
              },
            ],
          },
          {
            'id': 2,
            'parent_id': 1,
            'role': 'ASSISTANT',
            'status': 'FAILED',
            'inserted_at': '2024-01-01T00:00:02.000Z',
            'fragments': [
              {'type': 'THINK', 'content': '想想'},
            ],
          },
        ],
      });

      expect(result.conversation.id, 'ds-s1');
      expect(result.conversation.title, '读这个');
      expect(result.messages, hasLength(2));
      expect(result.messages[0].id, 'ds-s1-1');
      expect(result.messages[0].role, ChatRole.user);
      expect(result.messages[0].content, '读这个');
      expect(result.messages[0].files, ['a.pdf']);
      expect(result.messages[1].id, 'ds-s1-2');
      expect(result.messages[1].role, ChatRole.assistant);
      expect(result.messages[1].reasoning, '想想');
      expect(result.messages[1].status, MessageStatus.error);
      expect(result.messages[1].error, isNotNull);
    });

    test('TEMPLATE_RESPONSE 计入正文，THINK 以空行连接', () {
      final result = convertArchiveSession({
        'id': 's2',
        'title': '定标题',
        'current_message_id': 1,
        'inserted_at': '2024-01-01T00:00:00.000Z',
        'updated_at': '2024-01-01T00:00:00.000Z',
        'messages': [
          {
            'id': 1,
            'parent_id': null,
            'role': 'ASSISTANT',
            'status': 'DONE',
            'inserted_at': '2024-01-01T00:00:01.000Z',
            'fragments': [
              {'type': 'THINK', 'content': 'A'},
              {'type': 'THINK', 'content': 'B'},
              {'type': 'TEMPLATE_RESPONSE', 'content': '正文'},
            ],
          },
        ],
      });
      expect(result.conversation.title, '定标题');
      expect(result.messages.single.content, '正文');
      expect(result.messages.single.reasoning, 'A\n\nB');
    });
  });

  group('version 语义化比较', () {
    test('基本大小比较', () {
      expect(compareVersions('1.7.13', '1.7.12'), greaterThan(0));
      expect(compareVersions('2.0.0', '1.9.9'), greaterThan(0));
      expect(compareVersions('1.7.12', '1.7.12'), 0);
      expect(compareVersions('1.7.12', '1.7.13'), lessThan(0));
    });

    test('预发布版本低于正式版', () {
      expect(compareVersions('1.7.12-beta.1', '1.7.12'), lessThan(0));
    });

    test('isNewerVersion', () {
      expect(isNewerVersion('1.8.0', '1.7.12'), isTrue);
      expect(isNewerVersion('1.7.12', '1.8.0'), isFalse);
    });
  });
}
