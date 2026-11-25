import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';

/// 输入区：轻点输入、长按说话；上滑取消，松手转写。
///
/// - 多行自动增高（1→5 行后内部滚动），发送后保持焦点。
/// - 长按输入行进入语音：横向拖动不取消，上滑超过阈值取消。
/// - 聊天页把「深度思考 / 联网」等低频开关放在 header，不再占用顶栏。
class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.canSend,
    required this.onSend,
    required this.onAttach,
    this.onFocusChanged,
    this.hintText = '给 Dream 发送消息',
    this.header,
    this.voiceEnabled = false,
    this.onVoiceStart,
    this.onVoiceEnd,
    this.trailing,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool canSend;
  final ValueChanged<String> onSend; // 传输入文本
  final VoidCallback onAttach;
  final ValueChanged<bool>? onFocusChanged;
  final String hintText;

  /// 输入行上方的低频开关区（如深度思考、联网）。
  final Widget? header;

  final bool voiceEnabled;
  final VoidCallback? onVoiceStart;

  /// `cancel == true` 表示上滑取消，不转写。
  final ValueChanged<bool>? onVoiceEnd;

  /// 旧接口保留：输入框右侧、发送按钮之前的可选控件。
  final Widget? trailing;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  bool _focused = false;
  bool _holding = false;
  bool _willCancel = false;
  bool _pointerDown = false;
  double _holdStartY = 0;
  Timer? _holdTimer;

  static const double _cancelDistance = 56;

  @override
  void initState() {
    super.initState();
    _focused = widget.focusNode.hasFocus;
    widget.focusNode.addListener(_handleFocusChange);
  }

  @override
  void didUpdateWidget(Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.focusNode != widget.focusNode) {
      oldWidget.focusNode.removeListener(_handleFocusChange);
      widget.focusNode.addListener(_handleFocusChange);
      _focused = widget.focusNode.hasFocus;
    }
  }

  @override
  void dispose() {
    _holdTimer?.cancel();
    widget.focusNode.removeListener(_handleFocusChange);
    super.dispose();
  }

  void _handleFocusChange() {
    final value = widget.focusNode.hasFocus;
    if (value == _focused) {
      return;
    }
    setState(() => _focused = value);
    widget.onFocusChanged?.call(value);
  }

  void _handleSend() {
    final text = widget.controller.text.trim();
    if (text.isEmpty || !widget.canSend) {
      return;
    }
    HapticFeedback.mediumImpact();
    widget.onSend(text);
    widget.controller.clear();
    widget.focusNode.requestFocus();
  }

  void _handleAttach() {
    HapticFeedback.selectionClick();
    widget.onAttach();
  }

  void _onPointerDown(PointerDownEvent event) {
    if (!widget.voiceEnabled) return;
    _holdStartY = event.position.dy;
    _willCancel = false;
    _pointerDown = true;
    _holdTimer?.cancel();
    // 长按 420ms 进入语音；轻点仍然交给 TextField 聚焦。
    _holdTimer = Timer(const Duration(milliseconds: 420), () {
      if (!mounted || !_pointerDown) return;
      HapticFeedback.mediumImpact();
      setState(() => _holding = true);
      widget.onVoiceStart?.call();
    });
  }

  void _onPointerMove(PointerMoveEvent event) {
    if (!_pointerDown) return;
    if (!_holding) {
      if ((event.position.dy - _holdStartY).abs() > 12) {
        _holdTimer?.cancel();
      }
      return;
    }
    final cancel = (_holdStartY - event.position.dy) > _cancelDistance;
    if (cancel != _willCancel) {
      HapticFeedback.selectionClick();
      setState(() => _willCancel = cancel);
    }
  }

  void _onPointerUp(PointerEvent event) {
    _pointerDown = false;
    _holdTimer?.cancel();
    _holdTimer = null;
    if (!_holding) return;
    final cancel = _willCancel;
    setState(() {
      _holding = false;
      _willCancel = false;
    });
    widget.onVoiceEnd?.call(cancel);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    return AnimatedContainer(
      duration: reduceMotion ? Duration.zero : DreamMotion.fast,
      curve: DreamMotion.standard,
      decoration: BoxDecoration(
        color: palette.composer,
        border: Border(
          top: BorderSide(
            color: _focused ? theme.colorScheme.primary : palette.border,
            width: _focused ? 1.5 : 1,
          ),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(
        DreamSpacing.sm,
        DreamSpacing.xs,
        DreamSpacing.sm,
        DreamSpacing.xs,
      ),
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.only(bottom: DreamSpacing.xxs),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.header != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  DreamSpacing.xs,
                  0,
                  DreamSpacing.xs,
                  DreamSpacing.xxs,
                ),
                child: widget.header,
              ),
            Stack(
              children: [
                Opacity(
                  opacity: _holding ? 0 : 1,
                  child: Listener(
                    onPointerDown: _onPointerDown,
                    onPointerMove: _onPointerMove,
                    onPointerUp: _onPointerUp,
                    onPointerCancel: _onPointerUp,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        IconButton(
                          tooltip: '附件',
                          onPressed: _handleAttach,
                          icon: Icon(
                            Icons.add_rounded,
                            color: palette.textSecondary,
                          ),
                        ),
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              vertical: DreamSpacing.sm,
                            ),
                            child: Semantics(
                              textField: true,
                              label: '消息输入框',
                              child: TextField(
                                controller: widget.controller,
                                focusNode: widget.focusNode,
                                minLines: 1,
                                maxLines: 5,
                                keyboardType: TextInputType.multiline,
                                textInputAction: TextInputAction.newline,
                                cursorColor: theme.colorScheme.primary,
                                enableInteractiveSelection: _focused,
                                style: theme.textTheme.bodyLarge?.copyWith(
                                  color: palette.textPrimary,
                                ),
                                decoration: InputDecoration(
                                  hintText: widget.hintText,
                                  hintStyle: theme.textTheme.bodyLarge
                                      ?.copyWith(color: palette.textTertiary),
                                  border: InputBorder.none,
                                  isDense: true,
                                  contentPadding: EdgeInsets.zero,
                                ),
                              ),
                            ),
                          ),
                        ),
                        if (widget.trailing != null) widget.trailing!,
                        IconButton(
                          tooltip: '发送',
                          onPressed: widget.canSend ? _handleSend : null,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(
                            minWidth: 44,
                            minHeight: 44,
                          ),
                          icon: AnimatedContainer(
                            duration: reduceMotion
                                ? Duration.zero
                                : DreamMotion.fast,
                            curve: DreamMotion.standard,
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: widget.canSend
                                  ? theme.colorScheme.primary
                                  : palette.border,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              Icons.arrow_upward_rounded,
                              size: 20,
                              color: widget.canSend
                                  ? Colors.white
                                  : palette.textTertiary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (_holding)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: _VoiceHoldBar(willCancel: _willCancel),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _VoiceHoldBar extends StatelessWidget {
  const _VoiceHoldBar({required this.willCancel});

  final bool willCancel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return SizedBox(
      height: 56,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedContainer(
            duration: DreamMotion.fast,
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: willCancel
                  ? palette.textTertiary
                  : theme.colorScheme.error,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: DreamSpacing.sm),
          Text(
            willCancel ? '松开取消' : '正在聆听 · 上滑取消',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: willCancel ? palette.textTertiary : palette.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}
