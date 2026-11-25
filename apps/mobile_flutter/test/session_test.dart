import 'package:flutter_test/flutter_test.dart';

import 'package:dream/app/session_controller.dart';
import 'package:dream/app/token_holder.dart';
import 'package:dream/services/api_client.dart';
import 'package:dream/services/session_store.dart';

/// 只覆盖 bootstrap，不触碰平台安全存储。
class _EmptyStore extends SessionStore {
  @override
  Future<String?> getToken() async => null;

  @override
  Future<void> setUserId(String userId) async {}

  @override
  Future<void> clearToken() async {}
}

void main() {
  test('bootstrap 无 token 时进入匿名态并通知监听者', () async {
    final controller = SessionController(
      api: ApiClient(baseUrl: 'http://127.0.0.1:1', tokenProvider: () => ''),
      store: _EmptyStore(),
      tokenHolder: TokenHolder(),
    );
    var notified = 0;
    controller.addListener(() => notified++);

    await controller.bootstrap();

    expect(controller.status, AuthStatus.anonymous);
    expect(notified, 1);
  });
}
