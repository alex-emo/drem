import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';

import '../../core/models.dart';
import '../../services/api_client.dart';

/// 附件本地校验失败（如超过大小限制），区别于网络 [ChatApiError]。
class AttachException implements Exception {
  const AttachException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// 附件列表 / 上传 / 删除 / 聊天引用选择。
class AttachController extends ChangeNotifier {
  /// 与服务端 `MAX_FILE_BYTES` 一致的单文件上限。
  static const int maxFileBytes = 1024 * 1024;

  AttachController({required ApiClient api}) : _api = api;

  final ApiClient _api;
  final List<FileAttachment> _files = [];
  final Set<String> _selectedIds = {};
  bool _uploading = false;

  /// 已上传附件（只读快照）。
  List<FileAttachment> get files => List.unmodifiable(_files);

  /// 是否正在上传。
  bool get uploading => _uploading;

  /// 聊天引用中勾选的附件 id。
  Set<String> get selectedIds => Set.unmodifiable(_selectedIds);

  /// 拉取服务端附件列表。
  Future<void> load() async {
    final loaded = await _api.listFiles();
    _files
      ..clear()
      ..addAll(loaded);
    _selectedIds.removeWhere((id) => !_files.any((f) => f.id == id));
    notifyListeners();
  }

  /// 打开系统文件选择器选单个文件并上传；取消返回 null。
  Future<FileAttachment?> pickAndUpload() async {
    final picked = await FilePicker.pickFile();
    if (picked == null) return null;
    final size = picked.lengthSync() ?? (await picked.length()) ?? 0;
    return uploadPicked(
      path: picked.path,
      name: picked.name,
      size: size,
      readBytes: picked.readAsBytes,
    );
  }

  /// 校验大小并上传。独立抽出便于测试；[readBytes] 用于无本地路径的文件。
  Future<FileAttachment?> uploadPicked({
    String? path,
    required String name,
    required int size,
    Future<Uint8List> Function()? readBytes,
  }) async {
    if (size > maxFileBytes) {
      throw const AttachException('文件超过 1 MiB 限制');
    }
    final filePath = path ?? await _materialize(readBytes, name);
    _uploading = true;
    notifyListeners();
    try {
      final attachment = await _api.uploadFile(filePath, name);
      if (!_files.any((f) => f.id == attachment.id)) {
        _files.add(attachment);
      }
      // 刚上传的文件默认引用到下一轮对话；用户可再取消勾选。
      _selectedIds.add(attachment.id);
      return attachment;
    } finally {
      _uploading = false;
      notifyListeners();
    }
  }

  /// 删除附件（服务端 + 本地）。
  Future<void> remove(String id) async {
    await _api.deleteFile(id);
    _files.removeWhere((f) => f.id == id);
    _selectedIds.remove(id);
    notifyListeners();
  }

  /// 切换某附件是否被勾选为聊天引用。
  void toggleSelected(String id) {
    if (!_selectedIds.add(id)) {
      _selectedIds.remove(id);
    }
    notifyListeners();
  }

  /// 发送后清空引用选择（不删除已上传文件）。
  void clearSelection() {
    if (_selectedIds.isEmpty) return;
    _selectedIds.clear();
    notifyListeners();
  }

  /// 返回当前勾选且仍存在的已上传文件 id，供聊天请求 `files` 字段使用。
  Future<List<String>> pickForChat() async {
    return _files.map((f) => f.id).where(_selectedIds.contains).toList();
  }

  Future<String> _materialize(
    Future<Uint8List> Function()? readBytes,
    String name,
  ) async {
    final bytes = await (readBytes?.call() ?? Future.value(Uint8List(0)));
    final dir = await Directory.systemTemp.createTemp('dream_attach_');
    final file = File('${dir.path}/$name');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }
}
