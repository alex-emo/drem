import 'dart:async';

import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../design/dream_theme.dart';
import '../design/dream_scroll_physics.dart';
import '../design/tokens.dart';
import '../shared/widgets/dream_mark.dart';
import 'app_scope.dart';
import 'login_screen.dart';
import 'router.dart';
import 'session_controller.dart';
import 'theme_controller.dart';

class DreamApp extends StatefulWidget {
  const DreamApp({super.key, required this.preferences, this.services});

  final SharedPreferences preferences;

  /// 真实服务容器；为 null 时进入预览模式（无登录、无网络），供 widget 测试。
  final AppServices? services;

  @override
  State<DreamApp> createState() => _DreamAppState();
}

class _DreamAppState extends State<DreamApp> {
  late final ThemeController _themeController;
  late final GoRouter _router;

  bool _preparing = false;
  bool _ready = false;
  String? _syncError;

  @override
  void initState() {
    super.initState();
    _themeController = ThemeController(widget.preferences);
    _router = createRouter();
    final services = widget.services;
    if (services != null) {
      services.session.addListener(_onSessionChanged);
      unawaited(services.session.bootstrap());
    }
  }

  @override
  void dispose() {
    widget.services?.session.removeListener(_onSessionChanged);
    _router.dispose();
    _themeController.dispose();
    super.dispose();
  }

  void _onSessionChanged() {
    final services = widget.services;
    if (services == null) return;
    if (services.session.status == AuthStatus.authenticated) {
      if (!_ready && !_preparing) {
        unawaited(_prepare());
      }
      return;
    }
    if (_ready || _syncError != null || _preparing) {
      setState(() {
        _ready = false;
        _preparing = false;
        _syncError = null;
      });
    }
  }

  /// 登录后：取云备份密钥 → 拉取合并；失败不阻塞本地聊天（密钥仍尝试补取）。
  Future<void> _prepare() async {
    final services = widget.services;
    if (services == null) return;
    setState(() {
      _preparing = true;
      _syncError = null;
    });
    try {
      await services.cloud.unlock();
    } catch (e) {
      _syncError = _describe(e);
    }
    try {
      if (await services.store.getSessionKey() == null) {
        final meta = await services.api.getBackupMeta();
        final key = meta['key'] as String?;
        if (key != null && key.isNotEmpty) {
          await services.store.setSessionKey(key);
        }
      }
    } catch (e) {
      _syncError ??= _describe(e);
    }
    final hasKey = await services.store.getSessionKey() != null;
    if (!mounted) return;
    setState(() {
      _preparing = false;
      _ready = hasKey;
      if (!hasKey) {
        _syncError ??= '无法获取端到端加密密钥，请检查网络后重试。';
      }
    });
  }

  static String _describe(Object error) {
    final text = error.toString();
    return text.replaceFirst(RegExp(r'^[A-Za-z]+Exception:\s*'), '');
  }

  @override
  Widget build(BuildContext context) {
    final services = widget.services;
    if (services == null) {
      return AnimatedBuilder(
        animation: _themeController,
        builder: (context, _) => MaterialApp.router(
          title: 'Dream',
          debugShowCheckedModeBanner: false,
          theme: DreamTheme.light(),
          darkTheme: DreamTheme.dark(),
          themeMode: _themeController.mode,
          themeAnimationDuration: DreamMotion.page,
          themeAnimationCurve: DreamMotion.standard,
          scrollBehavior: const DreamScrollBehavior(),
          routerConfig: _router,
          builder: _appBuilder,
        ),
      );
    }
    return AppScope(
      services: services,
      child: AnimatedBuilder(
        animation: Listenable.merge([services.session, _themeController]),
        builder: (context, _) {
          final session = services.session;
          final authed = session.status == AuthStatus.authenticated;
          if (authed && _ready) {
            return MaterialApp.router(
              title: 'Dream',
              debugShowCheckedModeBanner: false,
              theme: DreamTheme.light(),
              darkTheme: DreamTheme.dark(),
              themeMode: _themeController.mode,
              themeAnimationDuration: DreamMotion.page,
              themeAnimationCurve: DreamMotion.standard,
              scrollBehavior: const DreamScrollBehavior(),
              routerConfig: _router,
              builder: _appBuilder,
            );
          }
          return MaterialApp(
            title: 'Dream',
            debugShowCheckedModeBanner: false,
            theme: DreamTheme.light(),
            darkTheme: DreamTheme.dark(),
            themeMode: _themeController.mode,
            themeAnimationDuration: DreamMotion.page,
            themeAnimationCurve: DreamMotion.standard,
            scrollBehavior: const DreamScrollBehavior(),
            home: session.status == AuthStatus.anonymous
                ? LoginScreen(controller: session)
                : _BootScreen(
                    error: authed ? _syncError : null,
                    onRetry: authed ? _prepare : null,
                  ),
            builder: _appBuilder,
          );
        },
      ),
    );
  }

  Widget _appBuilder(BuildContext context, Widget? child) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return ThemeScope(
      controller: _themeController,
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: (isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
            .copyWith(
              statusBarColor: Colors.transparent,
              systemNavigationBarColor: Colors.transparent,
              statusBarIconBrightness: isDark
                  ? Brightness.light
                  : Brightness.dark,
              systemNavigationBarIconBrightness: isDark
                  ? Brightness.light
                  : Brightness.dark,
              systemNavigationBarContrastEnforced: false,
            ),
        child: child ?? const SizedBox.shrink(),
      ),
    );
  }
}

/// 启动/解锁等待页：品牌标记 + 细进度条；失败时可重试。
class _BootScreen extends StatelessWidget {
  const _BootScreen({this.error, this.onRetry});

  final String? error;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<DreamPalette>()!;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: DreamSpacing.pageMargin,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const DreamMark(size: 44),
              const SizedBox(height: DreamSpacing.xl),
              SizedBox(
                width: 96,
                child: LinearProgressIndicator(
                  minHeight: 2,
                  backgroundColor: palette.border,
                  color: DreamColors.brand,
                ),
              ),
              if (error != null) ...[
                const SizedBox(height: DreamSpacing.lg),
                Text(
                  error!,
                  textAlign: TextAlign.center,
                  style: text.bodySmall?.copyWith(color: palette.textSecondary),
                ),
                if (onRetry != null) ...[
                  const SizedBox(height: DreamSpacing.md),
                  TextButton(onPressed: onRetry, child: const Text('重试')),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}
