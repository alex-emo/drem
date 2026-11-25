/// 消息树纯函数：无 IO、可单测。语义对齐 web `branches.ts`。
library;

import 'models.dart';

/// 从 [messages] 中选根：优先 [preferred]（须存在），否则第一个无 parentId 的消息，
/// 否则第一条消息；空列表返回 null。
String? pickRoot(List<Message> messages, {String? preferred}) {
  if (messages.isEmpty) return null;
  final byId = {for (final m in messages) m.id: m};
  if (preferred != null && byId.containsKey(preferred)) return preferred;
  for (final m in messages) {
    if (m.parentId == null) return m.id;
  }
  return messages.first.id;
}

List<Message> _chronological(List<Message> messages) {
  final sorted = [...messages];
  sorted.sort((a, b) {
    final byTime = a.createdAt.compareTo(b.createdAt);
    if (byTime != 0) return byTime;
    return a.id.compareTo(b.id);
  });
  return sorted;
}

/// 规范化：按 createdAt 升序（tie 按 id 字典序）排序；无树（无任何 parentId）时
/// 逐条补 parentId/selectedChildId 链。返回新列表，不改入参。
List<Message> normalizeMessages(List<Message> messages) {
  if (messages.isEmpty) return [];
  final sorted = _chronological(messages);
  final hasTree = sorted.any((m) => m.parentId != null);
  if (hasTree) return sorted;
  return List.generate(sorted.length, (index) {
    final current = sorted[index];
    return current.copyWith(
      parentId: index == 0 ? null : sorted[index - 1].id,
      selectedChildId: index < sorted.length - 1 ? sorted[index + 1].id : null,
    );
  });
}

/// 沿 selectedChildId 还原当前选中分支；子节点缺失时回退到最早的兄弟；seen 防环。
List<Message> getVisibleMessages(List<Message> messages, {String? rootId}) {
  if (messages.isEmpty) return [];
  final byId = {for (final m in messages) m.id: m};
  String? cursor = (rootId != null && byId.containsKey(rootId))
      ? rootId
      : messages
            .firstWhere((m) => m.parentId == null, orElse: () => messages.first)
            .id;
  final seen = <String>{};
  final path = <Message>[];
  while (cursor != null) {
    final message = byId[cursor];
    if (message == null || seen.contains(message.id)) break;
    seen.add(message.id);
    path.add(message);
    var next = message.selectedChildId;
    if (next == null || !byId.containsKey(next)) {
      next = _childrenOf(messages, message.id).firstOrNull?.id;
    }
    cursor = next;
  }
  return path;
}

List<Message> _childrenOf(List<Message> messages, String parentId) =>
    _chronological(messages.where((m) => m.parentId == parentId).toList());

/// 按 parentId 分组（chronological），产出每个 id 的版本组与下标。
Map<String, ({List<String> ids, int index})> buildVersions(
  List<Message> messages,
) {
  final groups = <String?, List<Message>>{};
  for (final message in messages) {
    final key = message.parentId;
    (groups[key] ??= []).add(message);
  }
  final versions = <String, ({List<String> ids, int index})>{};
  for (final group in groups.values) {
    final ids = _chronological(group).map((m) => m.id).toList();
    for (var index = 0; index < ids.length; index++) {
      versions[ids[index]] = (ids: ids, index: index);
    }
  }
  return versions;
}

/// 取首行、去 `#`、去首尾空白，裁到 24 字。
String makeTitle(String text) {
  final firstLine = text.split('\n').first;
  final cleaned = firstLine.replaceAll('#', '').trim();
  if (cleaned.length <= 24) return cleaned;
  return cleaned.substring(0, 24);
}

extension _FirstOrNull<T> on List<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
