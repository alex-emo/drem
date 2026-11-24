import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 只持久化 themeMode；不碰聊天数据。
class ThemeController extends ChangeNotifier {
  ThemeController(this._preferences)
    : _mode = _decode(_preferences.getString(_storageKey));

  static const String _storageKey = 'dream.theme.mode';

  final SharedPreferences _preferences;
  ThemeMode _mode;

  ThemeMode get mode => _mode;

  void setMode(ThemeMode mode) {
    if (_mode == mode) {
      return;
    }
    _mode = mode;
    notifyListeners();
    unawaited(_preferences.setString(_storageKey, mode.name));
  }

  static ThemeMode _decode(String? value) {
    return switch (value) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }
}

/// 把 controller 放到 MaterialApp 之上，设置页可以直接读写并跟随重建。
class ThemeScope extends InheritedNotifier<ThemeController> {
  const ThemeScope({
    super.key,
    required ThemeController controller,
    required super.child,
  }) : super(notifier: controller);

  static ThemeController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<ThemeScope>();
    assert(scope != null, 'ThemeScope 不在当前 context 之上');
    return scope!.notifier!;
  }
}
