import 'package:dream/design/dream_theme.dart';
import 'package:dream/shared/widgets/pressable_scale.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  testWidgets('PressableScale 暴露可激活的按钮语义', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: DreamTheme.dark(),
        home: Scaffold(
          body: Center(
            child: PressableScale(
              onTap: () => taps++,
              child: const Text('继续上次'),
            ),
          ),
        ),
      ),
    );
    final semantics = tester.ensureSemantics();
    expect(
      tester.getSemantics(find.byType(PressableScale)),
      matchesSemantics(
        isButton: true,
        hasTapAction: true,
        hasEnabledState: true,
        isEnabled: true,
      ),
    );
    semantics.dispose();
    await tester.tap(find.text('继续上次'));
    expect(taps, 1);
  });
}
