import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../../../design/dream_theme.dart';
import '../voice_controller.dart';

/// 语音输入按钮：按住说话（长按）、点击开始/停止，结果回填到文本框。
class VoiceInputButton extends StatefulWidget {
  const VoiceInputButton({
    super.key,
    required this.controller,
    required this.onResult,
    this.onError,
    this.enabled = true,
  });

  final VoiceController controller;

  /// 转写最终文本回填回调。
  final void Function(String text) onResult;
  final void Function(String msg)? onError;
  final bool enabled;

  @override
  State<VoiceInputButton> createState() => _VoiceInputButtonState();
}

class _VoiceInputButtonState extends State<VoiceInputButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
    lowerBound: 0.6,
    upperBound: 1.0,
  );

  bool get _listening => widget.controller.isListening;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChanged);
    _pulse.dispose();
    super.dispose();
  }

  void _onChanged() {
    if (widget.controller.isListening && !_pulse.isAnimating) {
      _pulse.repeat(reverse: true);
    } else if (!widget.controller.isListening && _pulse.isAnimating) {
      _pulse.stop();
      _pulse.value = 1.0;
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<DreamPalette>()!;
    final primary = Theme.of(context).colorScheme.primary;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return AnimatedBuilder(
      animation: _pulse,
      builder: (context, child) {
        final scale = reduceMotion ? 1.0 : _pulse.value;
        return GestureDetector(
          onLongPressStart: widget.enabled && !_listening
              ? (_) => _start()
              : null,
          onLongPressEnd: _listening ? (_) => _stop() : null,
          onTap: widget.enabled ? _toggle : null,
          child: Tooltip(
            message: '语音输入',
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: _listening ? primary : palette.composer,
                shape: BoxShape.circle,
                border: Border.all(color: palette.border),
              ),
              child: Transform.scale(
                scale: scale,
                child: Icon(
                  _listening ? Icons.mic : Icons.mic_none,
                  size: 20,
                  color: _listening ? Colors.white : palette.textSecondary,
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _toggle() async {
    if (_listening) {
      await _stop();
    } else {
      await _start();
    }
  }

  Future<void> _start() async {
    if (_listening) return;
    await widget.controller.startRealtime(
      onPartial: (partial, full) {},
      onFinal: (text) {
        if (text.trim().isNotEmpty) {
          widget.onResult(text);
        }
      },
      onError: (msg) => widget.onError?.call(msg),
    );
  }

  Future<void> _stop() async {
    await widget.controller.stopRealtime();
  }
}
