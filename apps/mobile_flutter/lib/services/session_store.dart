/// 凭据/密钥安全存储：flutter_secure_storage 封装；顶层提供设备名/平台标签。
library;

import 'dart:io';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionStore {
  static const String _tokenKey = 'dream-token';
  static const String _sessionKeyKey = 'dream-encryption-key';
  static const String _deviceIdKey = 'dream-device-id';
  static const String _localOwnerKey = 'dream-local-owner';
  static const String _userIdKey = 'dream-user';

  final FlutterSecureStorage _storage;

  SessionStore({FlutterSecureStorage? storage})
    : _storage =
          storage ?? const FlutterSecureStorage(aOptions: AndroidOptions());

  Future<String?> getToken() => _storage.read(key: _tokenKey);
  Future<void> setToken(String token) =>
      _storage.write(key: _tokenKey, value: token);
  Future<void> clearToken() => _storage.delete(key: _tokenKey);

  Future<String?> getSessionKey() => _storage.read(key: _sessionKeyKey);
  Future<void> setSessionKey(String key) =>
      _storage.write(key: _sessionKeyKey, value: key);

  Future<String> getOrCreateDeviceId() async {
    final existing = await _storage.read(key: _deviceIdKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final id = 'dev-${DateTime.now().millisecondsSinceEpoch}-${_rand4hex()}';
    await _storage.write(key: _deviceIdKey, value: id);
    return id;
  }

  Future<String?> getLocalOwner() => _storage.read(key: _localOwnerKey);
  Future<void> setLocalOwner(String owner) =>
      _storage.write(key: _localOwnerKey, value: owner);

  Future<String?> getUserId() => _storage.read(key: _userIdKey);
  Future<void> setUserId(String userId) =>
      _storage.write(key: _userIdKey, value: userId);

  Future<void> clearAll() => _storage.deleteAll();
}

String _rand4hex() {
  final random = Random.secure();
  return random.nextInt(0x10000).toRadixString(16).padLeft(4, '0');
}

/// 设备名（无 device_info 依赖时退化为平台名）。
String deviceName() => platformLabel();

/// 平台标签：Android / iOS / 其他。
String platformLabel() {
  if (Platform.isAndroid) return 'Android';
  if (Platform.isIOS) return 'iOS';
  return 'Unknown';
}
