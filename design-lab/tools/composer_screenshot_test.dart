// 截图工具：输入区的「空闲 / 打字 / 录音中」四态（深色三态、浅色一态）。
//
// 不是常规测试，故意不放在 test/ 下。用法：
//   1. python3 design-lab/tools/ttc2ttf.py \
//        /usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc /tmp/noto-cjk
//   2. cp design-lab/tools/composer_screenshot_test.dart \
//        apps/mobile_flutter/test/_shot_voice_test.dart
//   3. cd apps/mobile_flutter && ../../.flutter/bin/flutter test test/_shot_voice_test.dart
//   4. 产出 /tmp/dream-shot-voice-{idle,typing,listening,typing-light,light}.png；归档后删除临时测试。
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'package:dream/design/dream_theme.dart';
import 'package:dream/features/chat/widgets/composer.dart';

Future<void> _loadFont(String family, String path) async {
  final bytes = await File(path).readAsBytes();
  final loader = FontLoader(family)
    ..addFont(Future.value(ByteData.view(Uint8List.fromList(bytes).buffer)));
  await loader.load();
}

void main() {
  setUpAll(() async {
    await _loadFont('Shot', '/tmp/noto-cjk-2.ttf');
    await _loadFont(
      'MaterialIcons',
      '/home/alex/doc/code/project/dream/.flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    );
  });

  Future<void> capture(WidgetTester tester, String key, String path) async {
    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(ValueKey(key)),
    );
    final image = await boundary.toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File(path).writeAsBytes(bytes!.buffer.asUint8List());
  }

  Future<void> pumpComposer(
    WidgetTester tester, {
    required bool light,
    required String key,
    String? text,
    int seconds = 0,
  }) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    if (text != null) controller.text = text;
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        themeMode: light ? ThemeMode.light : ThemeMode.dark,
        theme: DreamTheme.light().copyWith(
          textTheme: DreamTheme.light().textTheme.apply(fontFamily: 'Shot'),
        ),
        darkTheme: DreamTheme.dark().copyWith(
          textTheme: DreamTheme.dark().textTheme.apply(fontFamily: 'Shot'),
        ),
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: RepaintBoundary(
              key: ValueKey(key),
              child: Composer(
                controller: controller,
                focusNode: focus,
                canSend: text != null,
                onSend: (_) {},
                onAttach: () {},
                voiceEnabled: true,
                onVoiceStart: () async => true,
                onVoiceEnd: (_) {},
                hintText: '轻点输入，长按说话',
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));
    if (seconds > 0) {
      await tester.tap(find.byTooltip('语音输入'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(Duration(seconds: seconds));
    }
    expect(
      Theme.of(tester.element(find.byType(Composer))).brightness,
      light ? Brightness.light : Brightness.dark,
    );
  }

  testWidgets('dark idle', (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await pumpComposer(tester, light: false, key: 'idle');
    await tester.runAsync(
      () => capture(tester, 'idle', '/tmp/dream-shot-voice-idle.png'),
    );
  });

  testWidgets('dark typing', (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await pumpComposer(
      tester,
      light: false,
      key: 'typing',
      text: '语音还在，发送键出现了',
    );
    await tester.runAsync(
      () => capture(tester, 'typing', '/tmp/dream-shot-voice-typing.png'),
    );
  });

  testWidgets('dark listening', (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await pumpComposer(tester, light: false, key: 'listening', seconds: 7);
    await tester.runAsync(
      () => capture(tester, 'listening', '/tmp/dream-shot-voice-listening.png'),
    );
  });

  testWidgets('light typing', (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await pumpComposer(
      tester,
      light: true,
      key: 'lightTyping',
      text: '语音还在，发送键出现了',
    );
    await tester.runAsync(
      () => capture(
        tester,
        'lightTyping',
        '/tmp/dream-shot-voice-typing-light.png',
      ),
    );
  });

  testWidgets('light listening', (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await pumpComposer(tester, light: true, key: 'light', seconds: 7);
    await tester.runAsync(
      () => capture(tester, 'light', '/tmp/dream-shot-voice-light.png'),
    );
  });
}
