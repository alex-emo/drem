import 'package:flutter/foundation.dart';

import '../core/errors.dart';
import '../core/models.dart';
import '../services/api_client.dart';
import '../services/session_store.dart';
import 'token_holder.dart';

enum AuthStatus { checking, anonymous, authenticated }

/// 账号会话：bootstrap / 登录 / 注册 / 登出 / 401 失效。
/// 只负责鉴权态，不碰聊天数据。
class SessionController extends ChangeNotifier {
  SessionController({
    required this.api,
    required this.store,
    required this.tokenHolder,
  });

  final ApiClient api;
  final SessionStore store;
  final TokenHolder tokenHolder;

  AuthStatus _status = AuthStatus.checking;
  AuthUser? _user;
  String? _error;
  bool _busy = false;

  AuthStatus get status => _status;
  AuthUser? get user => _user;
  String? get error => _error;
  bool get busy => _busy;

  Future<void> bootstrap() async {
    final token = await store.getToken();
    if (token == null || token.isEmpty) {
      _anonymous();
      notifyListeners();
      return;
    }
    tokenHolder.value = token;
    try {
      final user = await api.me();
      _user = user;
      _status = AuthStatus.authenticated;
      await store.setUserId(user.id);
    } on ChatApiError catch (e) {
      if (e.status == 401 || e.status == 403) {
        await _clearToken();
        _anonymous();
      } else {
        // 网络问题：保留 token，但先以匿名态展示，可重试。
        _anonymous(error: e.fullMessage);
      }
    } catch (_) {
      _anonymous(error: '网络连接失败，请重试。');
    }
    notifyListeners();
  }

  Future<bool> login(String username, String password) =>
      _auth(() => api.login(username, password));

  Future<bool> register(
    String username,
    String password, {
    String? displayName,
  }) => _auth(() => api.register(username, password, displayName: displayName));

  Future<bool> _auth(Future<AuthResult> Function() run) async {
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      final result = await run();
      tokenHolder.value = result.token;
      await store.setToken(result.token);
      await store.setUserId(result.user.id);
      await store.setLocalOwner(result.user.id);
      _user = result.user;
      _status = AuthStatus.authenticated;
      return true;
    } on ChatApiError catch (e) {
      _error = e.fullMessage;
      return false;
    } catch (_) {
      _error = '网络连接失败，请重试。';
      return false;
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  /// 聊天域收到 401 时调用：清 token、回登录页。
  Future<void> handleUnauthorized() async {
    await _clearToken();
    _user = null;
    _status = AuthStatus.anonymous;
    _error = '登录已失效，请重新登录。';
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await api.logout();
    } catch (_) {
      // 登出失败不阻塞本地清理。
    }
    await _clearToken();
    _user = null;
    _status = AuthStatus.anonymous;
    notifyListeners();
  }

  Future<void> _clearToken() async {
    tokenHolder.value = '';
    await store.clearToken();
  }

  void _anonymous({String? error}) {
    tokenHolder.value = '';
    _user = null;
    _status = AuthStatus.anonymous;
    _error = error;
  }
}
