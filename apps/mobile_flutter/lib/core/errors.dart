/// 客户端错误码：与 web `api.ts` / 服务端 `protocol.ts` 对齐。
library;

/// 客户端错误码名 → 十六进制（对齐 api.md）。
const Map<String, String> clientErrorHex = {
  'NETWORK': '0x0001',
  'ABORTED': '0x0002',
  'INVALID_RESPONSE': '0x0003',
  'NO_STREAM_SUPPORT': '0x0004',
  'TIMEOUT': '0x0005',
  'HTTP_ERROR': '0x5000',
  'UNKNOWN': '0x5001',
};

const String _networkMessage = '网络连接失败，请检查网络后重试。';
const String _timeoutMessage = '请求超时，请检查网络后重试。';
const String _unknownMessage = '请求失败，请稍后重试。';

class ChatApiError implements Exception {
  final int status;
  final String? code;
  final String hex;
  final String message;
  final String? requestId;

  ChatApiError({
    this.status = 0,
    this.code,
    required this.hex,
    required this.message,
    this.requestId,
  });

  /// 统一对外文案：`0x… 中文原因（请求编号 req_…）`。
  String get fullMessage =>
      '$hex $message${requestId != null ? '（请求编号 $requestId）' : ''}';

  /// 从服务端 `{error:{code,hex,message,requestId}}` 的内层 error 对象构造。
  factory ChatApiError.fromServerError(
    Map<String, dynamic> err, {
    int status = 0,
  }) {
    final code = err['code'] as String?;
    final message = err['message'] as String? ?? '请求失败（HTTP $status）';
    final requestId = err['requestId'] as String?;
    final hex =
        err['hex'] as String? ??
        (code != null ? clientErrorHex[code] : null) ??
        clientErrorHex['HTTP_ERROR']!;
    return ChatApiError(
      status: status,
      code: code ?? 'HTTP_ERROR',
      hex: hex,
      message: message,
      requestId: requestId,
    );
  }

  factory ChatApiError.network() => ChatApiError(
    code: 'NETWORK',
    hex: clientErrorHex['NETWORK']!,
    message: _networkMessage,
  );

  factory ChatApiError.timeout() => ChatApiError(
    code: 'TIMEOUT',
    hex: clientErrorHex['TIMEOUT']!,
    message: _timeoutMessage,
  );

  factory ChatApiError.unknown() => ChatApiError(
    code: 'UNKNOWN',
    hex: clientErrorHex['UNKNOWN']!,
    message: _unknownMessage,
  );

  @override
  String toString() => fullMessage;
}
