import 'dart:convert';
import 'dart:typed_data';

import 'package:dream/core/errors.dart';
import 'package:dream/core/models.dart';
import 'package:dream/core/tree.dart';
import 'package:dream/core/trim.dart';
import 'package:dream/services/crypto_service.dart';
import 'package:flutter_test/flutter_test.dart';

DateTime _t(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);

Message _msg(
  String id, {
  String? parentId,
  String? selectedChildId,
  DateTime? createdAt,
  ChatRole role = ChatRole.user,
  String content = '',
  MessageStatus status = MessageStatus.done,
}) => Message(
  id: id,
  conversationId: 'c1',
  role: role,
  content: content,
  status: status,
  createdAt: createdAt ?? _t(0),
  parentId: parentId,
  selectedChildId: selectedChildId,
);

void main() {
  group('normalizeMessages', () {
    test('空列表返回空', () {
      expect(normalizeMessages([]), isEmpty);
    });

    test('无树逐条补 parentId/selectedChildId 链，按时间排序', () {
      final a = _msg('a', createdAt: _t(3));
      final b = _msg('b', createdAt: _t(1));
      final c = _msg('c', createdAt: _t(2));
      final normalized = normalizeMessages([a, b, c]);

      expect(normalized.map((m) => m.id).toList(), ['b', 'c', 'a']);
      expect(normalized[0].parentId, isNull);
      expect(normalized[0].selectedChildId, 'c');
      expect(normalized[1].parentId, 'b');
      expect(normalized[1].selectedChildId, 'a');
      expect(normalized[2].parentId, 'c');
      expect(normalized[2].selectedChildId, isNull);
      // 不改入参。
      expect([a, b, c].map((m) => m.parentId).toList(), [null, null, null]);
    });

    test('有树仅按时间排序，不重写结构', () {
      final a = _msg('a', createdAt: _t(1));
      final b = _msg('b', createdAt: _t(3), parentId: 'a');
      final c = _msg('c', createdAt: _t(2), parentId: 'a');
      final normalized = normalizeMessages([b, c, a]);

      expect(normalized.map((m) => m.id).toList(), ['a', 'c', 'b']);
      expect(normalized[0].parentId, isNull);
      expect(normalized[1].parentId, 'a');
    });
  });

  group('getVisibleMessages', () {
    test('沿 selectedChildId 走', () {
      final a = _msg('a', selectedChildId: 'b');
      final b = _msg('b', parentId: 'a', selectedChildId: 'c');
      final c = _msg('c', parentId: 'b');
      final visible = getVisibleMessages([c, b, a]);

      expect(visible.map((m) => m.id).toList(), ['a', 'b', 'c']);
    });

    test('selectedChildId 缺失回退最早兄弟', () {
      final a = _msg('a', selectedChildId: 'missing');
      final b = _msg('b', parentId: 'a');
      final c = _msg('c', parentId: 'a');
      final visible = getVisibleMessages([c, b, a]);

      expect(visible.map((m) => m.id).toList(), ['a', 'b']);
    });

    test('rootId 优先', () {
      final a = _msg('a');
      final b = _msg('b', parentId: 'a');
      final visible = getVisibleMessages([a, b], rootId: 'b');

      expect(visible.map((m) => m.id).toList(), ['b']);
    });
  });

  group('buildVersions', () {
    test('按 parentId 分组并给出下标', () {
      final a = _msg('a');
      final b = _msg('b', parentId: 'a');
      final c = _msg('c', parentId: 'a');
      final d = _msg('d', parentId: 'b');
      final versions = buildVersions([a, b, c, d]);

      expect(versions['a']!.ids, ['a']);
      expect(versions['a']!.index, 0);
      expect(versions['b']!.ids, ['b', 'c']);
      expect(versions['b']!.index, 0);
      expect(versions['c']!.ids, ['b', 'c']);
      expect(versions['c']!.index, 1);
      expect(versions['d']!.ids, ['d']);
    });
  });

  group('trimMessagesForRetry', () {
    Map<String, String> m(String role, [String content = '']) => {
      'role': role,
      'content': content,
    };

    test('超过 24 条保留最后 24 条', () {
      final messages = List.generate(30, (i) => m('user', 'c$i'));
      final trimmed = trimMessagesForRetry(messages);
      expect(trimmed.length, 24);
      expect(trimmed.first['content'], 'c6');
    });

    test('80k 字符上限，首条不判字符', () {
      final big = 'x' * 30000;
      final messages = [m('user', big), m('user', big), m('user', big)];
      final trimmed = trimMessagesForRetry(messages);
      // 30000 + 30000 <= 80000，再加 30000 超限 → 保留最后 2 条。
      expect(trimmed.length, 2);
    });

    test('裁到首个 user 之后', () {
      final messages = [
        m('assistant', 'a'),
        m('assistant', 'b'),
        m('user', 'c'),
        m('assistant', 'd'),
      ];
      final trimmed = trimMessagesForRetry(messages);
      expect(trimmed.length, 2);
      expect(trimmed.first['role'], 'user');
      expect(trimmed.first['content'], 'c');
    });

    test('不超大时原样返回', () {
      final messages = [m('user', 'hi')];
      expect(trimMessagesIfHuge(messages).length, 1);
    });
  });

  group('makeTitle', () {
    test('取首行、去 #、去空白、裁 24 字', () {
      expect(makeTitle('Hello World'), 'Hello World');
      expect(makeTitle('# Title\nsecond line'), 'Title');
      expect(makeTitle('  spaced  '), 'spaced');
      expect(makeTitle(''), '');
      expect(makeTitle('a' * 30), 'a' * 24);
    });
  });

  group('ChatApiError', () {
    test('fullMessage 拼接 hex + message + requestId', () {
      final error = ChatApiError(
        hex: '0x0001',
        message: '网络连接失败，请检查网络后重试。',
        requestId: 'req_123',
      );
      expect(error.fullMessage, '0x0001 网络连接失败，请检查网络后重试。（请求编号 req_123）');
    });

    test('无 requestId 时不拼编号', () {
      final error = ChatApiError(hex: '0x0001', message: '网络连接失败。');
      expect(error.fullMessage, '0x0001 网络连接失败。');
    });

    test('fromServerError 缺 message 用 HTTP 兜底', () {
      final error = ChatApiError.fromServerError(const {}, status: 500);
      expect(error.hex, '0x5000');
      expect(error.message, '请求失败（HTTP 500）');
    });
  });

  group('CryptoService', () {
    final crypto = const CryptoService();

    test('deriveKey 得 32 字节', () {
      expect(crypto.deriveKey('session-key').length, 32);
    });

    test('encryptText → decryptText 往返', () async {
      const key = 'test-session-key';
      const plain = '你好，Dream 世界 🌍';
      final encrypted = await crypto.encryptText(plain, key);
      expect(encrypted.split('.').length, 2);
      expect(await crypto.decryptText(encrypted, key), plain);
    });

    test('解密非法 payload 返回 null', () async {
      expect(await crypto.decryptText('not-a-valid-payload', 'key'), isNull);
    });

    test('gzip/ungzip 往返', () async {
      final bytes = utf8.encode('hello gzip 中文内容');
      final gz = await crypto.gzipBytes(Uint8List.fromList(bytes));
      final restored = await crypto.ungzipBytes(gz);
      expect(utf8.decode(restored), 'hello gzip 中文内容');
    });
  });
}
