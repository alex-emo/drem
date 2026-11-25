/// 上游上下文历史：过滤掉内容安全拦截/未完成的消息。
library;

import 'models.dart';

/// 过滤 excludeFromContext；user 全保留；assistant 仅 done/refused 且 content 非空。
List<Map<String, String>> historyFor(List<Message> visible) {
  return visible
      .where((m) => !m.excludeFromContext)
      .where(
        (m) =>
            m.role == ChatRole.user ||
            (m.role == ChatRole.assistant &&
                (m.status == MessageStatus.done ||
                    m.status == MessageStatus.refused) &&
                m.content.trim().isNotEmpty),
      )
      .map((m) => {'role': m.role.name, 'content': m.content})
      .toList();
}
