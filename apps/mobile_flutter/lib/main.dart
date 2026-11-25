import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'app/app_scope.dart';
import 'app/session_controller.dart';
import 'app/token_holder.dart';
import 'data/chat_repository.dart';
import 'features/chat/chat_controller.dart';
import 'features/cloud/cloud_sync_controller.dart';
import 'features/import/archive_import_controller.dart';
import 'features/import/share_import_controller.dart';
import 'features/update/update_controller.dart';
import 'services/api_client.dart';
import 'services/crypto_service.dart';
import 'services/session_store.dart';

/// 服务端地址：默认生产；本地联调可用
/// `--dart-define=DREAM_API_ORIGIN=http://192.168.x.x:8787`。
const String _apiOrigin = String.fromEnvironment(
  'DREAM_API_ORIGIN',
  defaultValue: 'https://dream.pum.org.cn',
);

/// 与 pubspec / Android versionName 对齐，用于更新检查。
const String _appVersion = '1.7.12';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  final preferences = await SharedPreferences.getInstance();
  final repo = await ChatRepository.open();
  final store = SessionStore();
  final tokenHolder = TokenHolder();
  final api = ApiClient(
    baseUrl: _apiOrigin,
    tokenProvider: () => tokenHolder.value,
  );
  const crypto = CryptoService();
  final session = SessionController(
    api: api,
    store: store,
    tokenHolder: tokenHolder,
  );
  final chat = ChatController(
    api: ApiClientChatApi(api),
    repo: RepositoryChatStore(repo),
    crypto: crypto,
    session: store,
  );
  final cloud = CloudSyncController(
    api: api,
    repo: repo,
    crypto: crypto,
    session: store,
  );
  final services = AppServices(
    api: api,
    store: store,
    tokenHolder: tokenHolder,
    session: session,
    crypto: crypto,
    repo: repo,
    chat: chat,
    cloud: cloud,
    shareImport: ShareImportController(api: api, repo: repo),
    archiveImport: ArchiveImportController(api: api, repo: repo),
    update: UpdateController(api: api, currentVersion: _appVersion),
  );

  runApp(DreamApp(preferences: preferences, services: services));
}
