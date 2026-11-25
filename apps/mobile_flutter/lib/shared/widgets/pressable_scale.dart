import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../design/tokens.dart';

/// 统一的按压反馈：轻微缩放 + 触感。禁用时保留原样，不做伪交互。
class PressableScale extends StatefulWidget {
  const PressableScale({
    super.key,
    required this.child,
    this.onTap,
    this.pressedScale = 0.97,
  });

  final Widget child;
  final VoidCallback? onTap;
  final double pressedScale;

  @override
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _pressed = false;

  bool get _enabled => widget.onTap != null;

  void _setPressed(bool value) {
    if (!_enabled || _pressed == value) {
      return;
    }
    setState(() => _pressed = value);
  }

  void _handleTap() {
    HapticFeedback.selectionClick();
    widget.onTap?.call();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return Semantics(
      button: _enabled,
      enabled: _enabled,
      // GestureDetector 不产生无障碍动作；显式补 onTap，读屏才能激活。
      onTap: _enabled ? _handleTap : null,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: _enabled ? (_) => _setPressed(true) : null,
        onTapUp: _enabled ? (_) => _setPressed(false) : null,
        onTapCancel: _enabled ? () => _setPressed(false) : null,
        onTap: _enabled ? _handleTap : null,
        child: AnimatedScale(
          // 减少动效时缩放直接归 1，只保留状态突变，不做按压位移。
          scale: reduceMotion ? 1.0 : (_pressed ? widget.pressedScale : 1.0),
          duration: reduceMotion
              ? Duration.zero
              : (_pressed ? DreamMotion.pressIn : DreamMotion.pressOut),
          curve: Curves.easeOut,
          child: widget.child,
        ),
      ),
    );
  }
}
