/// HTTP + SSE 客户端：对齐 web `api.ts`，错误码/裁剪重试/云备份协议一致。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../core/errors.dart';
import '../core/models.dart';
import '../core/trim.dart';

const int _gzipThreshold = 256 * 1024;
const Duration _longTimeout = Duration(seconds: 30);

class ApiClient {
  final String baseUrl;
  final String Function() tokenProvider;
  final http.Client _client;

  ApiClient({
    required this.baseUrl,
    required this.tokenProvider,
    http.Client? client,
  }) : _client = client ?? http.Client();

  /// 普通 JSON 请求；非 2xx 抛 [ChatApiError]，网络/超时映射 network/timeout。
  Future<Map<String, dynamic>> requestJson(
    String method,
    String path, {
    Object? body,
    Map<String, String>? headers,
    Duration timeout = const Duration(seconds: 15),
    bool gzipBody = false,
  }) async {
    final uri = Uri.parse('$baseUrl/api/v1$path');
    final request = http.Request(method, uri);
    request.headers['accept'] = 'application/json';
    final token = tokenProvider();
    if (token.isNotEmpty) request.headers['authorization'] = 'Bearer $token';
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      List<int> bytes = utf8.encode(jsonEncode(body));
      if (gzipBody && bytes.length >= _gzipThreshold) {
        bytes = gzip.encode(bytes);
        request.headers['content-encoding'] = 'gzip';
      }
      request.bodyBytes = bytes;
    }
    request.headers.addAll(headers ?? const {});

    final response = await _send(request, timeout);
    final bodyBytes = await response.stream.toBytes().timeout(timeout);
    final text = utf8.decode(bodyBytes, allowMalformed: true);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _errorFromBody(text, response.statusCode);
    }
    return _decodeJsonObject(text);
  }

  Future<AuthResult> register(
    String username,
    String password, {
    String? displayName,
    String? deviceId,
    String? deviceName,
    String? platform,
  }) async {
    final data = await requestJson(
      'POST',
      '/auth/register',
      body: {
        'username': username,
        'password': password,
        'displayName': ?displayName,
        'deviceId': deviceId ?? 'unknown-device',
        'deviceName': deviceName ?? 'app',
        'platform': platform ?? 'app',
      },
    );
    return AuthResult.fromJson(data);
  }

  Future<AuthResult> login(
    String username,
    String password, {
    String? deviceId,
    String? deviceName,
    String? platform,
  }) async {
    final data = await requestJson(
      'POST',
      '/auth/login',
      body: {
        'username': username,
        'password': password,
        'deviceId': deviceId ?? 'unknown-device',
        'deviceName': deviceName ?? 'app',
        'platform': platform ?? 'app',
      },
    );
    return AuthResult.fromJson(data);
  }

  Future<AuthUser> me() async {
    final data = await requestJson('GET', '/me');
    return AuthUser.fromJson(Map<String, dynamic>.from(data['user'] as Map));
  }

  Future<void> logout() async {
    try {
      await requestJson('POST', '/auth/logout');
    } catch (_) {
      // 失败静默：本地凭证由调用方清除。
    }
  }

  Future<List<FileAttachment>> listFiles() async {
    final data = await requestJson('GET', '/files');
    final files = data['files'];
    if (files is! List) return const [];
    return files
        .whereType<Map>()
        .map((f) => FileAttachment.fromJson(Map<String, dynamic>.from(f)))
        .toList();
  }

  Future<FileAttachment> uploadFile(String filePath, String filename) async {
    final uri = Uri.parse('$baseUrl/api/v1/files');
    final request = http.MultipartRequest('POST', uri);
    final token = tokenProvider();
    if (token.isNotEmpty) request.headers['authorization'] = 'Bearer $token';
    request.files.add(
      await http.MultipartFile.fromPath('file', filePath, filename: filename),
    );
    final response = await _send(request, _longTimeout);
    final bodyBytes = await response.stream.toBytes().timeout(_longTimeout);
    final text = utf8.decode(bodyBytes, allowMalformed: true);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _errorFromBody(text, response.statusCode);
    }
    return FileAttachment.fromJson(_decodeJsonObject(text));
  }

  Future<void> deleteFile(String id) async {
    await requestJson('DELETE', '/files/${Uri.encodeComponent(id)}');
  }

  Future<Map<String, dynamic>> importShare(String url) async {
    return requestJson('GET', '/import/share?url=${Uri.encodeComponent(url)}');
  }

  Future<Map<String, dynamic>> getBackupMeta() async {
    try {
      return await requestJson('GET', '/backup/meta');
    } on ChatApiError catch (e) {
      if (e.status == 404) return {'backup': null};
      rethrow;
    }
  }

  Future<({Uint8List body, String? ivB64, String? encoding})>
  getBackupStream() async {
    final uri = Uri.parse('$baseUrl/api/v1/backup/stream');
    final request = http.Request('GET', uri);
    request.headers['accept'] = 'application/octet-stream';
    final token = tokenProvider();
    if (token.isNotEmpty) request.headers['authorization'] = 'Bearer $token';
    final response = await _send(request, _longTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final bodyBytes = await response.stream.toBytes().timeout(_longTimeout);
      final text = utf8.decode(bodyBytes, allowMalformed: true);
      throw _errorFromBody(text, response.statusCode);
    }
    final bodyBytes = await response.stream.toBytes().timeout(_longTimeout);
    return (
      body: Uint8List.fromList(bodyBytes),
      ivB64: response.headers['x-backup-iv'],
      encoding: response.headers['x-backup-encoding'],
    );
  }

  Future<Map<String, dynamic>> putBackupStream(
    Uint8List body, {
    required String ivB64,
  }) async {
    final uri = Uri.parse('$baseUrl/api/v1/backup/stream');
    final request = http.Request('PUT', uri);
    request.headers['accept'] = 'application/json';
    request.headers['content-type'] = 'application/octet-stream';
    request.headers['x-backup-iv'] = ivB64;
    request.headers['x-backup-encoding'] = 'gzip';
    final token = tokenProvider();
    if (token.isNotEmpty) request.headers['authorization'] = 'Bearer $token';
    request.bodyBytes = body;
    final response = await _send(request, _longTimeout);
    final bodyBytes = await response.stream.toBytes().timeout(_longTimeout);
    final text = utf8.decode(bodyBytes, allowMalformed: true);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _errorFromBody(text, response.statusCode);
    }
    return _decodeJsonObject(text);
  }

  Future<Map<String, dynamic>> getRelease() => requestJson('GET', '/release');

  Future<Map<String, dynamic>> feedback(Map<String, dynamic> fields) async {
    final uri = Uri.parse('$baseUrl/api/v1/feedback');
    final request = http.MultipartRequest('POST', uri);
    request.headers['accept'] = 'application/json';
    final token = tokenProvider();
    if (token.isNotEmpty) request.headers['authorization'] = 'Bearer $token';
    for (final entry in fields.entries) {
      final value = entry.value;
      if (entry.key == 'screenshot') {
        if (value is Uint8List) {
          request.files.add(
            http.MultipartFile.fromBytes(
              'screenshot',
              value,
              filename: 'screenshot.png',
            ),
          );
        } else if (value is File) {
          request.files.add(
            await http.MultipartFile.fromPath('screenshot', value.path),
          );
        } else if (value is String && value.isNotEmpty) {
          request.files.add(
            await http.MultipartFile.fromPath('screenshot', value),
          );
        }
        continue;
      }
      if (value != null) request.fields[entry.key] = value.toString();
    }
    final response = await _send(request, _longTimeout);
    final bodyBytes = await response.stream.toBytes().timeout(_longTimeout);
    final text = utf8.decode(bodyBytes, allowMalformed: true);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _errorFromBody(text, response.statusCode);
    }
    return _decodeJsonObject(text);
  }

  /// 聊天 SSE：返回各事件 data 的 JSON Stream；`event:error` 抛 ChatApiError。
  /// 发送前超 800000 字符先裁剪；无输出且可重试时 trim 后重试一次；取消时关闭
  /// 本次流式连接。
  Future<Stream<Map<String, dynamic>>> chatStream(
    Map<String, dynamic> body, {
    void Function()? onCancel,
  }) async {
    var received = false;
    var prepared = _trimForSend(body);

    http.Client? activeClient;
    final controller = StreamController<Map<String, dynamic>>(
      onCancel: () {
        onCancel?.call();
        activeClient?.close();
      },
    );

    Future<void> attempt(Map<String, dynamic> currentBody) async {
      final client = http.Client();
      activeClient = client;
      try {
        await _streamChatOnce(
          client,
          currentBody,
          controller,
          onOutput: () => received = true,
        );
      } finally {
        if (identical(activeClient, client)) activeClient = null;
        client.close();
      }
    }

    Future<void> run() async {
      try {
        await attempt(prepared);
      } catch (error) {
        if (!received && _isRetryableStreamError(error)) {
          final trimmed = _trimForRetry(prepared);
          final retryBody =
              (trimmed['messages'] as List).length <
                  (prepared['messages'] as List).length
              ? trimmed
              : prepared;
          try {
            await attempt(retryBody);
          } catch (retryError) {
            if (!controller.isClosed) {
              controller.addError(_normalizeStreamError(retryError));
            }
          }
        } else {
          if (!controller.isClosed) {
            controller.addError(_normalizeStreamError(error));
          }
        }
      } finally {
        if (!controller.isClosed) await controller.close();
      }
    }

    unawaited(run());
    return controller.stream;
  }

  Future<void> _streamChatOnce(
    http.Client client,
    Map<String, dynamic> body,
    StreamController<Map<String, dynamic>> controller, {
    required void Function() onOutput,
  }) async {
    final uri = Uri.parse('$baseUrl/api/v1/chat');
    final request = http.Request('POST', uri);
    request.headers['accept'] = 'text/event-stream';
    request.headers['content-type'] = 'application/json';
    final token = tokenProvider();
    if (token.isNotEmpty) request.headers['authorization'] = 'Bearer $token';
    List<int> bytes = utf8.encode(jsonEncode(body));
    if (bytes.length >= _gzipThreshold) {
      bytes = gzip.encode(bytes);
      request.headers['content-encoding'] = 'gzip';
    }
    request.bodyBytes = bytes;

    final response = await client.send(request);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final bodyBytes = await response.stream.toBytes();
      final text = utf8.decode(bodyBytes, allowMalformed: true);
      throw _errorFromBody(text, response.statusCode);
    }
    final contentType = response.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().contains('text/event-stream')) {
      throw ChatApiError(
        status: response.statusCode,
        code: 'INVALID_RESPONSE',
        hex: clientErrorHex['INVALID_RESPONSE']!,
        message: '服务端返回了非流式响应',
      );
    }
    await _consumeSse(response.stream, (block) {
      _handleSseBlock(block, controller, onOutput);
    });
  }

  Future<http.StreamedResponse> _send(
    http.BaseRequest request,
    Duration timeout,
  ) async {
    try {
      return await _client.send(request).timeout(timeout);
    } on SocketException {
      throw ChatApiError.network();
    } on TimeoutException {
      throw ChatApiError.timeout();
    } on http.ClientException {
      throw ChatApiError.network();
    }
  }

  Map<String, dynamic> _trimForSend(Map<String, dynamic> body) {
    final plain = _plainMessages(body);
    if (totalChars(plain) <= hugeThreshold) return body;
    return _withMessages(body, trimMessagesForRetry(plain));
  }

  Map<String, dynamic> _trimForRetry(Map<String, dynamic> body) {
    return _withMessages(body, trimMessagesForRetry(_plainMessages(body)));
  }
}

Future<void> _consumeSse(
  Stream<List<int>> byteStream,
  void Function(String block) onBlock,
) async {
  var buffer = '';
  await for (final text in byteStream.transform(utf8.decoder)) {
    buffer += text.replaceAll('\r\n', '\n');
    while (true) {
      final index = buffer.indexOf('\n\n');
      if (index == -1) break;
      onBlock(buffer.substring(0, index));
      buffer = buffer.substring(index + 2);
    }
  }
  if (buffer.trim().isNotEmpty) onBlock(buffer);
}

void _handleSseBlock(
  String block,
  StreamController<Map<String, dynamic>> controller,
  void Function() onOutput,
) {
  var event = 'message';
  final dataLines = <String>[];
  for (final line in block.split('\n')) {
    if (line.isEmpty || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.add(line.substring(5).replaceFirst(RegExp(r'^ '), ''));
    }
  }
  if (dataLines.isEmpty) return;
  final payload = dataLines.join('\n').trim();
  if (payload.isEmpty) return;
  final Object? data;
  try {
    data = jsonDecode(payload);
  } catch (_) {
    return;
  }
  if (data is! Map) return;
  final map = Map<String, dynamic>.from(data);

  if (event == 'error') {
    final err = map['error'];
    final errMap = err is Map
        ? Map<String, dynamic>.from(err)
        : const <String, dynamic>{};
    throw ChatApiError.fromServerError(errMap, status: 0);
  }

  if (event == 'thinking' ||
      event == 'delta' ||
      event == 'sources' ||
      event == 'refusal') {
    onOutput();
  }
  // 保留 SSE `event:` 名，供消费方区分 thinking / delta（payload 形状相同）。
  map['_event'] = event;
  if (!controller.isClosed) controller.add(map);
}

List<Map<String, String>> _plainMessages(Map<String, dynamic> body) {
  final raw = body['messages'];
  if (raw is! List) return const [];
  return raw.map((m) {
    if (m is! Map) {
      return <String, String>{'role': 'user', 'content': ''};
    }
    return <String, String>{
      'role': (m['role'] as String?) ?? 'user',
      'content': (m['content'] as String?)?.toString() ?? '',
    };
  }).toList();
}

Map<String, dynamic> _withMessages(
  Map<String, dynamic> body,
  List<Map<String, String>> messages,
) {
  return {
    ...body,
    'messages': messages.map((m) => Map<String, dynamic>.from(m)).toList(),
  };
}

bool _isRetryableStreamError(Object error) {
  if (error is ChatApiError) {
    return error.status == 413 ||
        error.code == 'PAYLOAD_TOO_LARGE' ||
        (error.status == 0 &&
            (error.code == 'NETWORK' || error.code == 'TIMEOUT'));
  }
  if (error is TypeError) return true;
  final message = error.toString().toLowerCase();
  return message.contains('failed to fetch') ||
      message.contains('load failed') ||
      message.contains('network') ||
      message.contains('input stream') ||
      message.contains('stream closed');
}

Object _normalizeStreamError(Object error) {
  if (error is ChatApiError) return error;
  if (error is TimeoutException) return ChatApiError.timeout();
  if (error is TypeError ||
      error is SocketException ||
      error is http.ClientException) {
    return ChatApiError.network();
  }
  return error;
}

ChatApiError _errorFromBody(String text, int status) {
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

Map<String, dynamic> _decodeJsonObject(String text) {
  final decoded = jsonDecode(text);
  if (decoded is Map) return Map<String, dynamic>.from(decoded);
  return <String, dynamic>{};
}
