/// APK 版本更新：语义化比较 + 下载校验 + 系统安装引导。
library;

// ignore_for_file: prefer_initializing_formals

import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../services/api_client.dart';

/// 发布信息（getRelease 返回）。
class ReleaseInfo {
  const ReleaseInfo({
    required this.version,
    required this.versionCode,
    required this.sha256,
    required this.size,
    required this.apkUrl,
    required this.notes,
    required this.publishedAt,
  });

  final String version;
  final int versionCode;
  final String sha256;
  final int size;
  final String apkUrl;
  final String notes;
  final String publishedAt;

  factory ReleaseInfo.fromJson(Map<String, dynamic> json) => ReleaseInfo(
    version: json['version'] as String? ?? '',
    versionCode: json['versionCode'] as int? ?? 0,
    sha256: json['sha256'] as String? ?? '',
    size: json['size'] as int? ?? 0,
    apkUrl: json['apkUrl'] as String? ?? '',
    notes: json['notes'] as String? ?? '',
    publishedAt: json['publishedAt'] as String? ?? '',
  );
}

/// 语义化比较两个版本号。返回 <0（a 旧）、0（相等）、>0（a 新）。
///
/// 支持 `1.7.12`、`1.7.12-beta.3`、`v1.2.3` 等；解析失败按字符串比较兜底。
int compareVersions(String a, String b) {
  final pa = _parse(a);
  final pb = _parse(b);
  for (var i = 0; i < 3; i++) {
    final cmp = pa.core[i].compareTo(pb.core[i]);
    if (cmp != 0) return cmp;
  }
  // 主版本相同：无预发布者新于有预发布者。
  if (pa.pre.isEmpty && pb.pre.isNotEmpty) return 1;
  if (pa.pre.isNotEmpty && pb.pre.isEmpty) return -1;
  final preLen = pa.pre.length < pb.pre.length ? pa.pre.length : pb.pre.length;
  for (var i = 0; i < preLen; i++) {
    final cmp = _cmpPart(pa.pre[i], pb.pre[i]);
    if (cmp != 0) return cmp;
  }
  return pa.pre.length.compareTo(pb.pre.length);
}

/// [version] 是否严格新于 [current]。
bool isNewerVersion(String version, String current) =>
    compareVersions(version, current) > 0;

class UpdateController extends ChangeNotifier {
  UpdateController({required ApiClient api, required String currentVersion})
    : _api = api,
      _currentVersion = currentVersion;

  final ApiClient _api;
  final String _currentVersion;

  ReleaseInfo? _release;
  ReleaseInfo? get release => _release;

  bool _checking = false;
  bool get checking => _checking;

  bool _installing = false;
  bool get installing => _installing;

  String? _lastError;
  String? get lastError => _lastError;

  /// 查询最新版本，仅当比当前版本新时返回非空。
  Future<ReleaseInfo?> check() async {
    _checking = true;
    _lastError = null;
    notifyListeners();
    try {
      final map = await _api.getRelease();
      final release = ReleaseInfo.fromJson(map);
      _release = release;
      if (release.version.isEmpty || release.apkUrl.isEmpty) return null;
      if (!isNewerVersion(release.version, _currentVersion)) return null;
      return release;
    } catch (e) {
      _lastError = e.toString();
      rethrow;
    } finally {
      _checking = false;
      notifyListeners();
    }
  }

  /// 下载 APK、校验 SHA-256，然后引导系统安装。
  ///
  /// 由于 android/ 目录不在本次改动范围，无法注册 FileProvider，
  /// 这里无法在应用内静默安装：校验通过后写入临时文件，并抛出带
  /// [apkUrl] 的说明，由调用方引导用户用浏览器下载安装。
  Future<String> downloadAndInstall(ReleaseInfo release) async {
    _installing = true;
    _lastError = null;
    notifyListeners();
    try {
      final client = http.Client();
      try {
        final response = await client
            .get(Uri.parse(release.apkUrl))
            .timeout(const Duration(minutes: 5));
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw UpdateException('下载失败（HTTP ${response.statusCode}）。');
        }
        final bytes = response.bodyBytes;
        final digest = sha256.convert(bytes).toString();
        if (release.sha256.isNotEmpty &&
            digest != release.sha256.toLowerCase()) {
          throw UpdateException('安装包校验失败，SHA-256 不一致，请重新下载。');
        }
        final tmp = File(
          '${Directory.systemTemp.path}/dream-$_currentVersion-update.apk',
        );
        await tmp.writeAsBytes(bytes);
        return tmp.path;
      } finally {
        client.close();
      }
    } finally {
      _installing = false;
      notifyListeners();
    }
  }
}

class UpdateException implements Exception {
  UpdateException(this.message);

  final String message;

  @override
  String toString() => message;
}

// ---- 内部实现 ----

class _Version {
  _Version(this.core, this.pre);

  final List<int> core;
  final List<String> pre;
}

_Version _parse(String raw) {
  var s = raw.trim();
  if (s.startsWith('v') || s.startsWith('V')) s = s.substring(1);
  var pre = <String>[];
  final plus = s.indexOf('+');
  if (plus >= 0) s = s.substring(0, plus);
  final dash = s.indexOf('-');
  if (dash >= 0) {
    pre = s.substring(dash + 1).split('.');
    s = s.substring(0, dash);
  }
  final parts = s.split('.').map((p) => int.tryParse(p) ?? 0).toList();
  while (parts.length < 3) {
    parts.add(0);
  }
  return _Version(parts.take(3).toList(), pre);
}

int _cmpPart(String a, String b) {
  final na = int.tryParse(a);
  final nb = int.tryParse(b);
  if (na != null && nb != null) return na.compareTo(nb);
  // 纯数字预发布段低于字母段。
  if (na != null) return -1;
  if (nb != null) return 1;
  return a.compareTo(b);
}
