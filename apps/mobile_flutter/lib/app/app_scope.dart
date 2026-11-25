import 'package:flutter/widgets.dart';

import '../data/chat_repository.dart';
import '../features/chat/chat_controller.dart';
import '../features/cloud/cloud_sync_controller.dart';
import '../features/import/archive_import_controller.dart';
import '../features/import/share_import_controller.dart';
import '../features/update/update_controller.dart';
import '../services/api_client.dart';
import '../services/crypto_service.dart';
import '../services/session_store.dart';
import 'session_controller.dart';
import 'token_holder.dart';

/// 应用级依赖容器：所有控制器在此装配一次，通过 [AppScope] 下发。
class AppServices {
  AppServices({
    required this.api,
    required this.store,
    required this.tokenHolder,
    required this.session,
    required this.crypto,
    required this.repo,
    required this.chat,
    required this.cloud,
    required this.shareImport,
    required this.archiveImport,
    required this.update,
  });

  final ApiClient api;
  final SessionStore store;
  final TokenHolder tokenHolder;
  final SessionController session;
  final CryptoService crypto;
  final ChatRepository repo;
  final ChatController chat;
  final CloudSyncController cloud;
  final ShareImportController shareImport;
  final ArchiveImportController archiveImport;
  final UpdateController update;
}

/// 把 [AppServices] 放到 MaterialApp 之上；`context` 下的页面可直接取。
class AppScope extends InheritedWidget {
  const AppScope({super.key, required this.services, required super.child});

  final AppServices services;

  static AppServices of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope 不在当前 context 之上');
    return scope!.services;
  }

  /// 预览/测试模式（无真实服务）返回 null。
  static AppServices? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<AppScope>()?.services;
  }

  @override
  bool updateShouldNotify(AppScope oldWidget) => services != oldWidget.services;
}
