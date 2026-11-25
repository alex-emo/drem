import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import '../../core/errors.dart';
import '../../services/api_client.dart';
import '../../services/session_store.dart';
import 'wav.dart';

/// 语音相关本地错误（权限 / 录音失败等）。
class VoiceException implements Exception {
  const VoiceException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// 服务端 WS 文本帧解析结果。
class AsrFrame {
  const AsrFrame(this.type, this.text);

  /// `ready` | `partial` | `final` | `error` | `unknown`。
  final String type;

  /// partial/final 的文本，或 error 的 message；其余为空串。
  final String text;
}

/// 解析 ASR WS 文本帧（纯函数，便于测试）。
AsrFrame parseAsrFrame(String raw) {
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return const AsrFrame('unknown', '');
    final type = decoded['type'];
    if (type is! String) return const AsrFrame('unknown', '');
    switch (type) {
      case 'ready':
        return const AsrFrame('ready', '');
      case 'partial':
      case 'final':
        return AsrFrame(type, (decoded['text'] as String?) ?? '');
      case 'error':
        return AsrFrame('error', (decoded['message'] as String?) ?? '');
      default:
        return const AsrFrame('unknown', '');
    }
  } catch (_) {
    return const AsrFrame('unknown', '');
  }
}

/// 语音录制 / HTTP ASR / WS 实时转写。
class VoiceController extends ChangeNotifier {
  static const int _sampleRate = 16000;
  static const int _numChannels = 1;

  VoiceController({required ApiClient api, required SessionStore session})
    : _api = api,
      _session = session;

  final ApiClient _api;
  final SessionStore _session;

  final AudioRecorder _recorder = AudioRecorder();
  final BytesBuilder _pcmBuffer = BytesBuilder(copy: false);

  StreamSubscription<Uint8List>? _recordSub;
  WebSocket? _ws;
  StreamSubscription<dynamic>? _wsSub;
  Timer? _forceCloseTimer;

  bool _recording = false;
  bool _listening = false;
  String _realtimeFull = '';

  /// 是否正在实时转写（WS 已连、正在收 partial）。
  bool get isListening => _listening;

  /// 是否正在录音（HTTP 路径，为产物 WAV）。
  bool get isRecording => _recording;

  static const RecordConfig _pcmConfig = RecordConfig(
    encoder: AudioEncoder.pcm16bits,
    sampleRate: _sampleRate,
    numChannels: _numChannels,
  );

  /// 读取 WAV 文件并以裸 `audio/wav` 提交 `/api/v1/tools/asr`，返回转写文本。
  Future<String> transcribeFile(String wavPath) async {
    final bytes = await File(wavPath).readAsBytes();
    final uri = Uri.parse('${_api.baseUrl}/api/v1/tools/asr');
    final token = _api.tokenProvider();
    try {
      final response = await http
          .post(
            uri,
            headers: {
              'accept': 'application/json',
              'content-type': 'audio/wav',
              if (token.isNotEmpty) 'authorization': 'Bearer $token',
            },
            body: bytes,
          )
          .timeout(const Duration(seconds: 30));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw _asrErrorFromBody(response.body, response.statusCode);
      }
      final decoded = jsonDecode(response.body);
      if (decoded is Map) {
        return (decoded['text'] as String?) ?? '';
      }
      return '';
    } on SocketException {
      throw ChatApiError.network();
    } on TimeoutException {
      throw ChatApiError.timeout();
    }
  }

  /// 请求麦克风权限。
  Future<bool> requestMicrophonePermission() async {
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  /// 开始录音（raw PCM 累积到缓冲区，产物为 WAV）。
  Future<void> startRecording() async {
    if (_recording || _listening) return;
    if (!await requestMicrophonePermission()) {
      throw const VoiceException('未获得麦克风权限');
    }
    _pcmBuffer.clear();
    final stream = await _recorder.startStream(_pcmConfig);
    _recordSub = stream.listen(
      _pcmBuffer.add,
      onError: (Object error) {
        _recording = false;
        notifyListeners();
      },
    );
    _recording = true;
    notifyListeners();
  }

  /// 停止录音，组装 WAV 写到临时文件并返回路径（未在录音时返回 null）。
  Future<String?> stopRecording() async {
    if (!_recording) return null;
    _recording = false;
    await _recordSub?.cancel();
    _recordSub = null;
    await _recorder.stop();
    final wav = pcmToWav(_pcmBuffer.takeBytes());
    final path = await _writeTempWav(wav);
    notifyListeners();
    return path;
  }

  /// 录制并走 HTTP ASR，返回转写文本（便捷组合）。
  Future<String> recordAndTranscribe() async {
    await startRecording();
    final path = await stopRecording();
    if (path == null) return '';
    return transcribeFile(path);
  }

  /// 开始 WS 实时转写：连接 `/api/v1/asr/ws`，流式发送 raw PCM 帧。
  Future<void> startRealtime({
    required void Function(String partial, String full) onPartial,
    required void Function(String text) onFinal,
    required void Function(String msg) onError,
  }) async {
    if (_listening || _recording) return;
    if (!await requestMicrophonePermission()) {
      onError('未获得麦克风权限');
      return;
    }
    final token = await _session.getToken() ?? '';
    final WebSocket ws;
    try {
      ws = await WebSocket.connect(_wsUrl(), protocols: ['dream.asr', token]);
    } catch (_) {
      onError('语音连接失败，请检查网络后重试。');
      return;
    }
    _ws = ws;
    _listening = true;
    _realtimeFull = '';
    notifyListeners();

    _wsSub = ws.listen(
      (data) {
        if (data is! String) return;
        final frame = parseAsrFrame(data);
        switch (frame.type) {
          case 'partial':
            final delta = frame.text.startsWith(_realtimeFull)
                ? frame.text.substring(_realtimeFull.length)
                : frame.text;
            _realtimeFull = frame.text;
            onPartial(delta, frame.text);
          case 'final':
            onFinal(frame.text);
          case 'error':
            onError(frame.text);
        }
      },
      onDone: _cleanupRealtime,
      onError: (Object error) {
        onError('语音连接中断。');
        _cleanupRealtime();
      },
    );

    try {
      final stream = await _recorder.startStream(_pcmConfig);
      _recordSub = stream.listen(
        (chunk) => _ws?.add(chunk),
        onError: (Object error) {
          onError('录音失败。');
        },
      );
    } catch (_) {
      onError('无法启动录音。');
      await stopRealtime();
    }
  }

  /// 停止实时转写：发 `finish`，停录音，等待服务端 final 后关闭。
  Future<void> stopRealtime() async {
    if (_ws == null && !_listening) return;
    _listening = false;
    notifyListeners();
    try {
      _ws?.add(jsonEncode({'type': 'finish'}));
    } catch (_) {}
    await _recordSub?.cancel();
    _recordSub = null;
    try {
      await _recorder.stop();
    } catch (_) {}
    // 服务端收到 finish 后 12s 内结束；兜底强关避免泄漏。
    _forceCloseTimer?.cancel();
    _forceCloseTimer = Timer(const Duration(seconds: 13), _forceCloseRealtime);
  }

  void _forceCloseRealtime() {
    _ws?.close();
    _cleanupRealtime();
  }

  void _cleanupRealtime() {
    _listening = false;
    _forceCloseTimer?.cancel();
    _forceCloseTimer = null;
    _ws = null;
    _wsSub = null;
    _recordSub?.cancel();
    _recordSub = null;
    notifyListeners();
  }

  String _wsUrl() {
    var base = _api.baseUrl;
    if (base.startsWith('http://')) {
      base = 'ws://${base.substring('http://'.length)}';
    } else if (base.startsWith('https://')) {
      base = 'wss://${base.substring('https://'.length)}';
    } else {
      base = 'ws://$base';
    }
    while (base.endsWith('/')) {
      base = base.substring(0, base.length - 1);
    }
    return '$base/api/v1/asr/ws';
  }

  Future<String> _writeTempWav(Uint8List wav) async {
    final dir = await Directory.systemTemp.createTemp('dream_voice_');
    final file = File(
      '${dir.path}/voice_${DateTime.now().millisecondsSinceEpoch}.wav',
    );
    await file.writeAsBytes(wav, flush: true);
    return file.path;
  }

  ChatApiError _asrErrorFromBody(String text, int status) {
    Map<String, dynamic> error = const {};
    try {
      final decoded = jsonDecode(text);
      if (decoded is Map && decoded['error'] is Map) {
        error = Map<String, dynamic>.from(decoded['error'] as Map);
      }
    } catch (_) {
      // 非 JSON 错误体：退化为 HTTP 错误。
    }
    return ChatApiError.fromServerError(error, status: status);
  }

  @override
  void dispose() {
    _forceCloseTimer?.cancel();
    _recordSub?.cancel();
    _wsSub?.cancel();
    _ws?.close();
    unawaited(_recorder.dispose());
    super.dispose();
  }
}
