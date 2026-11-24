import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../design/dream_theme.dart';
import '../design/tokens.dart';
import 'router.dart';
import 'theme_controller.dart';

class DreamApp extends StatefulWidget {
  const DreamApp({super.key, required this.preferences});

  final SharedPreferences preferences;

  @override
  State<DreamApp> createState() => _DreamAppState();
}

class _DreamAppState extends State<DreamApp> {
  late final ThemeController _themeController;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _themeController = ThemeController(widget.preferences);
    _router = createRouter();
  }

  @override
  void dispose() {
    _router.dispose();
    _themeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _themeController,
      builder: (context, _) {
        return MaterialApp.router(
          title: 'Dream',
          debugShowCheckedModeBanner: false,
          theme: DreamTheme.light(),
          darkTheme: DreamTheme.dark(),
          themeMode: _themeController.mode,
          themeAnimationDuration: DreamMotion.page,
          themeAnimationCurve: DreamMotion.standard,
          routerConfig: _router,
          builder: (context, child) {
            final isDark = Theme.of(context).brightness == Brightness.dark;
            return ThemeScope(
              controller: _themeController,
              child: AnnotatedRegion<SystemUiOverlayStyle>(
                value:
                    (isDark
                            ? SystemUiOverlayStyle.light
                            : SystemUiOverlayStyle.dark)
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
          },
        );
      },
    );
  }
}
