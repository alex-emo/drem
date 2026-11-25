/// 上下文裁剪纯函数：对齐 web `api.ts` 的 trimMessagesForRetry。
library;

const int retryMaxMessages = 24;
const int retryMaxChars = 80000;
const int hugeThreshold = 800000;

int totalChars(List<Map<String, String>> messages) {
  var chars = 0;
  for (final message in messages) {
    chars += (message['content'] ?? '').length;
  }
  return chars;
}

/// 从尾向前保留 ≤24 条且 ≤80000 字符（首条不判字符），再裁到首个 role==user 之后。
List<Map<String, String>> trimMessagesForRetry(
  List<Map<String, String>> messages,
) {
  final kept = <Map<String, String>>[];
  var chars = 0;
  for (var index = messages.length - 1; index >= 0; index--) {
    final message = messages[index];
    if (kept.length >= retryMaxMessages) break;
    final content = message['content'] ?? '';
    if (kept.isNotEmpty && chars + content.length > retryMaxChars) break;
    kept.insert(0, message);
    chars += content.length;
  }
  final firstUser = kept.indexWhere((m) => m['role'] == 'user');
  if (firstUser > 0) {
    return kept.sublist(firstUser);
  }
  return kept;
}

/// 仅当总量超过 800000 字符才裁剪；否则原样返回。
List<Map<String, String>> trimMessagesIfHuge(
  List<Map<String, String>> messages,
) {
  if (totalChars(messages) > hugeThreshold) {
    return trimMessagesForRetry(messages);
  }
  return messages;
}
