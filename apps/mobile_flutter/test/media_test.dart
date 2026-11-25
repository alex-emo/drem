import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:dream/core/models.dart';
import 'package:dream/features/attach/attach_controller.dart';
import 'package:dream/features/voice/voice_controller.dart';
import 'package:dream/features/voice/wav.dart';
import 'package:dream/services/api_client.dart';

class FakeApiClient extends ApiClient {
  FakeApiClient({this.initial = const []})
    : super(baseUrl: 'http://test.local', tokenProvider: () => 'test-token');

  final List<FileAttachment> initial;
  final List<String> deleted = [];

  @override
  Future<List<FileAttachment>> listFiles() async => List.of(initial);

  @override
  Future<FileAttachment> uploadFile(String filePath, String filename) async {
    return FileAttachment(
      id: 'uploaded-1',
      name: filename,
      bytes: 0,
      chars: 0,
      createdAt: DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  @override
  Future<void> deleteFile(String id) async {
    deleted.add(id);
  }
}

FileAttachment _attachment(String id, String name, int bytes) => FileAttachment(
  id: id,
  name: name,
  bytes: bytes,
  chars: 0,
  createdAt: DateTime.fromMillisecondsSinceEpoch(0),
);

void main() {
  group('pcmToWav', () {
    test('写 RIFF/WAVE/PCM 单声道 16k 16bit 头', () {
      final pcm = Uint8List.fromList([0, 1, 2, 3, 4, 5, 6, 7]);
      final wav = pcmToWav(pcm);

      expect(wav.length, 44 + 8);
      expect(ascii.decode(wav.sublist(0, 4)), 'RIFF');
      expect(ascii.decode(wav.sublist(8, 12)), 'WAVE');
      expect(ascii.decode(wav.sublist(12, 16)), 'fmt ');

      final data = ByteData.sublistView(wav);
      expect(data.getUint32(4, Endian.little), 36 + 8); // chunkSize
      expect(data.getUint16(20, Endian.little), 1); // audioFormat = PCM
      expect(data.getUint16(22, Endian.little), 1); // 单声道
      expect(data.getUint32(24, Endian.little), 16000); // 采样率
      expect(data.getUint16(34, Endian.little), 16); // 位深
      expect(ascii.decode(wav.sublist(36, 40)), 'data');
      expect(data.getUint32(40, Endian.little), 8); // dataSize
      expect(wav.sublist(44), pcm);
    });

    test('PCM 数据原样追加在头之后', () {
      final pcm = Uint8List.fromList(List.generate(16, (i) => i));
      final wav = pcmToWav(pcm);
      expect(wav.sublist(44), pcm);
    });
  });

  group('parseAsrFrame', () {
    test('ready', () {
      final frame = parseAsrFrame('{"type":"ready"}');
      expect(frame.type, 'ready');
      expect(frame.text, '');
    });

    test('partial 携带累积全文', () {
      final frame = parseAsrFrame('{"type":"partial","text":"你好世界"}');
      expect(frame.type, 'partial');
      expect(frame.text, '你好世界');
    });

    test('final 携带最终文本', () {
      final frame = parseAsrFrame('{"type":"final","text":"最终文本"}');
      expect(frame.type, 'final');
      expect(frame.text, '最终文本');
    });

    test('error 携带 message', () {
      final frame = parseAsrFrame('{"type":"error","message":"超时"}');
      expect(frame.type, 'error');
      expect(frame.text, '超时');
    });

    test('非法 JSON 或未知类型返回 unknown', () {
      expect(parseAsrFrame('not-json').type, 'unknown');
      expect(parseAsrFrame('{"type":"weird"}').type, 'unknown');
    });
  });

  group('AttachController', () {
    test('超过 1 MiB 拒绝上传', () async {
      final controller = AttachController(api: FakeApiClient());
      await expectLater(
        controller.uploadPicked(
          path: '/tmp/big.bin',
          name: 'big.bin',
          size: AttachController.maxFileBytes + 1,
        ),
        throwsA(isA<AttachException>()),
      );
      expect(controller.files, isEmpty);
      expect(controller.uploading, isFalse);
    });

    test('成功上传后加入 files', () async {
      final controller = AttachController(api: FakeApiClient());
      final uploaded = await controller.uploadPicked(
        path: '/tmp/a.txt',
        name: 'a.txt',
        size: 10,
      );
      expect(uploaded, isNotNull);
      expect(controller.files.map((f) => f.id), contains('uploaded-1'));
      expect(controller.files.map((f) => f.name), contains('a.txt'));
    });

    test('load 填充并 remove 删除', () async {
      final api = FakeApiClient(
        initial: [
          _attachment('1', 'one.txt', 10),
          _attachment('2', 'two.txt', 20),
        ],
      );
      final controller = AttachController(api: api);
      await controller.load();
      expect(controller.files, hasLength(2));

      await controller.remove('1');
      expect(api.deleted, contains('1'));
      expect(controller.files.map((f) => f.id), isNot(contains('1')));
      expect(controller.files.map((f) => f.id), contains('2'));
    });

    test('pickForChat 只返回勾选且仍存在的 id', () async {
      final controller = AttachController(api: FakeApiClient());
      await controller.uploadPicked(path: '/tmp/a.txt', name: 'a.txt', size: 1);
      // 新上传文件默认被引用；再切换一次即取消。
      expect(controller.selectedIds, contains('uploaded-1'));
      controller.toggleSelected('nonexistent');

      final ids = await controller.pickForChat();
      expect(ids, contains('uploaded-1'));
      expect(ids, isNot(contains('nonexistent')));
    });
  });
}
