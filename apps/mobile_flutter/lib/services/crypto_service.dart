/// AES-GCM 加密与 gzip 压缩：密钥派生、文本/字节加解密均与 web `crypto.ts` 对齐。
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';

class CryptoService {
  const CryptoService();

  AesGcm get _algorithm => AesGcm.with256bits();

  /// SHA-256 得 32B raw key，供 AES-GCM 256。
  Uint8List deriveKey(String sessionKey) {
    final digest = sha256.convert(utf8.encode(sessionKey)).bytes;
    return Uint8List.fromList(digest);
  }

  /// 加密文本：随机 IV 12B，返回 `base64(iv) + '.' + base64(cipher+tag)`。
  Future<String> encryptText(String plain, String sessionKey) async {
    final key = deriveKey(sessionKey);
    final iv = _randomBytes(12);
    final secretBox = await _algorithm.encrypt(
      utf8.encode(plain),
      secretKey: SecretKey(key),
      nonce: iv,
    );
    final cipher = secretBox.concatenation(nonce: false, mac: true);
    return '${base64Encode(iv)}.${base64Encode(cipher)}';
  }

  /// 解密 [payload]；格式不符或校验失败返回 null。
  Future<String?> decryptText(String payload, String sessionKey) async {
    try {
      final parts = payload.split('.');
      if (parts.length != 2) return null;
      final iv = base64Decode(parts[0]);
      final cipher = base64Decode(parts[1]);
      if (iv.length != 12 || cipher.length < 16) return null;
      final clear = await _decryptBytes(
        cipher,
        sessionKey,
        Uint8List.fromList(iv),
      );
      return utf8.decode(clear);
    } catch (_) {
      return null;
    }
  }

  Future<Uint8List> gzipBytes(Uint8List bytes) async =>
      Uint8List.fromList(gzip.encode(bytes));

  Future<Uint8List> ungzipBytes(Uint8List bytes) async =>
      Uint8List.fromList(gzip.decode(bytes));

  /// 加密字节：返回 `cipher + tag`（GCM 16B tag 附在末尾）。
  Future<Uint8List> encryptBytes(
    Uint8List plain,
    String sessionKey,
    Uint8List iv,
  ) async {
    final key = deriveKey(sessionKey);
    final secretBox = await _algorithm.encrypt(
      plain,
      secretKey: SecretKey(key),
      nonce: iv,
    );
    return Uint8List.fromList(secretBox.concatenation(nonce: false, mac: true));
  }

  /// 解密字节：[cipher] 为 `cipher + tag`。
  Future<Uint8List> decryptBytes(
    Uint8List cipher,
    String sessionKey,
    Uint8List iv,
  ) async {
    return _decryptBytes(cipher, sessionKey, iv);
  }

  Future<Uint8List> _decryptBytes(
    Uint8List cipher,
    String sessionKey,
    Uint8List iv,
  ) async {
    final key = deriveKey(sessionKey);
    final macBytes = cipher.sublist(cipher.length - 16);
    final cipherText = cipher.sublist(0, cipher.length - 16);
    final clear = await _algorithm.decrypt(
      SecretBox(cipherText, nonce: iv, mac: Mac(macBytes)),
      secretKey: SecretKey(key),
    );
    return Uint8List.fromList(clear);
  }

  Uint8List _randomBytes(int length) {
    final random = Random.secure();
    return Uint8List.fromList(
      List.generate(length, (_) => random.nextInt(256)),
    );
  }
}
