// 截图工具：把真实聊天界面渲染成 PNG，供设计核对。
//
// 它不是常规测试，故意不放在 test/ 下（否则 flutter test 会尝试运行它）。
// 用法：
//   1. 提取 TTF（FontLoader 读不了 .ttc）：
//        python3 design-lab/tools/ttc2ttf.py \
//          /usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc /tmp/noto-cjk
//      用 /tmp/noto-cjk-2.ttf（Noto Sans CJK SC）。
//   2. 复制到测试目录：
//        cp design-lab/tools/screenshot_test.dart \
//           apps/mobile_flutter/test/_shot_test.dart
//   3. 运行：
//        cd apps/mobile_flutter && ../../.flutter/bin/flutter test test/_shot_test.dart
//      产出 /tmp/dream-shot-dark.png 与 /tmp/dream-shot-light.png。
//   4. 确认后删除临时测试文件，截图归档到 design-lab/shots/。
//
// 依赖 apps/mobile_flutter/lib/dev/design_preview.dart 里的假数据控制器。
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dream/dev/design_preview.dart';

void main() {
  Future<void> loadFont(String family, String path) async {
    final bytes = await File(path).readAsBytes();
    final loader = FontLoader(family)
      ..addFont(Future.value(ByteData.view(Uint8List.fromList(bytes).buffer)));
    await loader.load();
  }

  setUpAll(() async {
    await loadFont('Shot', '/tmp/noto-cjk-2.ttf');
    await loadFont(
      'MaterialIcons',
      '/home/alex/doc/code/project/dream/.flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    );
  });

  testWidgets('render chat screen', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.binding.setSurfaceSize(const Size(430, 932));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final app = await buildPreviewApp(fontFamily: 'Shot');
    final lightApp = await buildPreviewApp(
      fontFamily: 'Shot',
      themeMode: ThemeMode.light,
    );
    await tester.pumpWidget(RepaintBoundary(key: const ValueKey('shot'), child: app));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }

    Future<void> capture(String path) async {
      final boundary = tester.renderObject<RenderRepaintBoundary>(
        find.byKey(const ValueKey('shot')),
      );
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await File(path).writeAsBytes(bytes!.buffer.asUint8List());
    }

    await tester.runAsync(() => capture('/tmp/dream-shot-dark.png'));

    await tester.pumpWidget(
      RepaintBoundary(key: const ValueKey('shot'), child: lightApp),
    );
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    await tester.runAsync(() => capture('/tmp/dream-shot-light.png'));
  });
}
