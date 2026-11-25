import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';

/// 输入区：轻点输入、长按说话；上滑取消，松手转写。
///
/// - 多行自动增高（1→5 行后内部滚动），发送后保持焦点。
/// - 输入为空且语音可用时，右侧主按钮由「发送」换成麦克风：轻点开始/停止
///   聆听（键盘不收起，参照 iOS 听写），覆盖条提供停止与取消。
/// - 长按输入行仍可进入按住说话：横向拖动不取消，上滑超过阈值取消。
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

  /// 开始录音；返回 `false` 表示没有真的开始（无权限、正在流式等），
  /// 由调用方决定如何提示，输入区据此退出聆听态。
  final Future<bool> Function()? onVoiceStart;

  /// `cancel == true` 表示取消，不转写。
  final ValueChanged<bool>? onVoiceEnd;

  /// 旧接口保留：输入框右侧、发送按钮之前的可选控件。
  final Widget? trailing;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  bool _focused = false;
  bool _holding = false;
  bool _listening = false;
  bool _starting = false;
  bool _holdStarted = false;
  bool _releasePending = false;
  bool _pendingCancel = false;
  bool _willCancel = false;
  bool _pointerDown = false;
  bool _empty = true;
  double _holdStartY = 0;
  Timer? _holdTimer;
  Timer? _ticker;
  int _seconds = 0;

  static const double _cancelDistance = 56;

  /// 录音上限：到点自动停止并转写，不静默丢弃（0006，参考微信 60 秒）。
  static const int _maxSeconds = 60;

  bool get _recording => _holding || _listening;

  @override
  void initState() {
    super.initState();
    _focused = widget.focusNode.hasFocus;
    _empty = widget.controller.text.trim().isEmpty;
    _holdStarted = false;
    widget.focusNode.addListener(_handleFocusChange);
    widget.controller.addListener(_handleTextChange);
  }

  @override
  void didUpdateWidget(Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.focusNode != widget.focusNode) {
      oldWidget.focusNode.removeListener(_handleFocusChange);
      widget.focusNode.addListener(_handleFocusChange);
      _focused = widget.focusNode.hasFocus;
    }
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_handleTextChange);
      widget.controller.addListener(_handleTextChange);
      _empty = widget.controller.text.trim().isEmpty;
    }
  }

  @override
  void dispose() {
    _holdTimer?.cancel();
    _ticker?.cancel();
    widget.focusNode.removeListener(_handleFocusChange);
    widget.controller.removeListener(_handleTextChange);
    super.dispose();
  }

  void _startTicker() {
    _ticker?.cancel();
    if (mounted) setState(() => _seconds = 0);
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || !_recording) return;
      setState(() => _seconds++);
      if (_seconds >= _maxSeconds) {
        HapticFeedback.mediumImpact();
        _finishRecording(cancel: false);
      }
    });
  }

  void _stopTicker() {
    _ticker?.cancel();
    _ticker = null;
  }

  void _finishRecording({required bool cancel}) {
    if (_holding) {
      _finishHold(cancel);
    } else if (_listening) {
      _stopListening(cancel: cancel);
    }
  }

  void _handleTextChange() {
    final empty = widget.controller.text.trim().isEmpty;
    if (empty != _empty) setState(() => _empty = empty);
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

  /// 轻点麦克风：开始/停止免提聆听。键盘保持打开（同 iOS 听写）。
  Future<void> _toggleListening() async {
    if (_listening) {
      _stopListening(cancel: false);
      return;
    }
    if (_starting || !widget.voiceEnabled) return;
    HapticFeedback.selectionClick();
    setState(() => _starting = true);
    final started = await _beginVoice();
    if (!mounted) return;
    setState(() {
      _starting = false;
      _listening = started;
    });
    if (started) _startTicker();
  }

  Future<bool> _beginVoice() async {
    final start = widget.onVoiceStart;
    if (start == null) return true;
    try {
      return await start();
    } catch (_) {
      // 具体错误由上层提示；这里只保证输入区不留在假聆听态。
      return false;
    }
  }

  void _stopListening({required bool cancel}) {
    if (!_listening) return;
    HapticFeedback.selectionClick();
    _stopTicker();
    setState(() {
      _listening = false;
      _willCancel = false;
    });
    widget.onVoiceEnd?.call(cancel);
  }

  void _onPointerDown(PointerDownEvent event) {
    if (!widget.voiceEnabled) return;
    // 已聚焦时，长按属于「选中文字 / 移动光标」，不能再抢去录音。
    // 语音的常驻入口是输入框右侧的麦克风（0005），长按只是加速器。
    if (widget.focusNode.hasFocus) return;
    if (_listening) return;
    _holdStartY = event.position.dy;
    _willCancel = false;
    _pointerDown = true;
    _holdStarted = false;
    _releasePending = false;
    _holdTimer?.cancel();
    // 长按 420ms 进入语音；轻点仍然交给 TextField 聚焦。
    _holdTimer = Timer(const Duration(milliseconds: 420), () async {
      if (!mounted || !_pointerDown) return;
      HapticFeedback.mediumImpact();
      setState(() => _holding = true);
      final ok = await _beginVoice();
      if (!mounted) return;
      if (!ok) {
        _resetHold();
        return;
      }
      _holdStarted = true;
      _startTicker();
      if (_releasePending) _finishHold(_pendingCancel);
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
    if (!_holdStarted) {
      // 录音还没真正开始（例如权限对话框），先记下松手，等结果再结算。
      _releasePending = true;
      _pendingCancel = _willCancel;
      return;
    }
    _finishHold(_willCancel);
  }

  void _finishHold(bool cancel) {
    if (!_holding) return;
    _stopTicker();
    setState(() {
      _holding = false;
      _willCancel = false;
      _holdStarted = false;
      _releasePending = false;
    });
    widget.onVoiceEnd?.call(cancel);
  }

  void _resetHold() {
    _stopTicker();
    setState(() {
      _holding = false;
      _willCancel = false;
      _holdStarted = false;
      _releasePending = false;
    });
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
                  opacity: (_holding || _listening) ? 0 : 1,
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
                        child: Listener(
                          onPointerDown: _onPointerDown,
                          onPointerMove: _onPointerMove,
                          onPointerUp: _onPointerUp,
                          onPointerCancel: _onPointerUp,
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
                      ),
                      if (widget.trailing != null) widget.trailing!,
                      if (widget.voiceEnabled)
                        Padding(
                          padding: const EdgeInsets.only(left: DreamSpacing.xs),
                          child: _MicButton(
                            listening: _listening,
                            emphasized: _empty,
                            onPressed: _starting ? null : _toggleListening,
                          ),
                        ),
                      // 发送键槽位常驻：麦克风固定在自己的位置，不因发送键
                      // 出现/消失而位移（0006 §4.2）。
                      if (widget.voiceEnabled)
                        const SizedBox(width: DreamSpacing.xs),
                      IgnorePointer(
                        ignoring: _empty,
                        child: AnimatedOpacity(
                          duration: reduceMotion
                              ? Duration.zero
                              : DreamMotion.fast,
                          opacity: _empty ? 0 : 1,
                          child: IconButton(
                            tooltip: '发送',
                            onPressed: widget.canSend ? _handleSend : null,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(
                              minWidth: 48,
                              minHeight: 48,
                            ),
                            icon: AnimatedContainer(
                              duration: reduceMotion
                                  ? Duration.zero
                                  : DreamMotion.fast,
                              curve: DreamMotion.standard,
                              width: 48,
                              height: 48,
                              decoration: BoxDecoration(
                                color: widget.canSend
                                    ? theme.colorScheme.primary
                                    : palette.border,
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                Icons.arrow_upward_rounded,
                                size: 22,
                                color: widget.canSend
                                    ? Colors.white
                                    : palette.textTertiary,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_holding || _listening)
                  Positioned.fill(
                    child: _VoiceBar(
                      willCancel: _willCancel,
                      handsFree: _listening,
                      seconds: _seconds,
                      onCancel: () => _finishRecording(cancel: true),
                      onStop: () => _finishRecording(cancel: false),
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

class _MicButton extends StatelessWidget {
  const _MicButton({
    required this.listening,
    required this.onPressed,
    this.emphasized = true,
  });

  final bool listening;
  final VoidCallback? onPressed;

  /// 空输入时麦克风是主动作（实心品牌）；有文字时让位给发送键，
  /// 退成描边圆但仍占固定槽位（0006 §4.2）。
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final disabled = onPressed == null;
    return IconButton(
      tooltip: '语音输入',
      onPressed: onPressed,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
      icon: AnimatedContainer(
        duration: DreamMotion.fast,
        curve: DreamMotion.standard,
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: disabled || listening
              ? palette.border
              : emphasized
              ? theme.colorScheme.primary
              : Colors.transparent,
          border: emphasized ? null : Border.all(color: palette.border),
          shape: BoxShape.circle,
        ),
        child: Icon(
          Icons.mic_none_rounded,
          size: 24,
          color: disabled
              ? palette.textTertiary
              : emphasized
              ? Colors.white
              : palette.textSecondary,
        ),
      ),
    );
  }
}

class _VoiceBar extends StatelessWidget {
  const _VoiceBar({
    required this.willCancel,
    required this.handsFree,
    required this.seconds,
    required this.onCancel,
    required this.onStop,
  });

  final bool willCancel;
  final bool handsFree;

  /// 已录秒数；到上限由 State 自动停止，这里只负责显示。
  final int seconds;
  final VoidCallback onCancel;
  final VoidCallback onStop;

  static String _clock(int seconds) {
    final minutes = seconds ~/ 60;
    final rest = seconds % 60;
    return '$minutes:${rest.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final dot = AnimatedContainer(
      duration: DreamMotion.fast,
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: willCancel ? palette.textTertiary : theme.colorScheme.error,
        shape: BoxShape.circle,
      ),
    );
    final label = Text(
      willCancel
          ? '松开取消'
          : handsFree
          ? '正在录音'
          : '正在录音 · 上滑取消',
      style: theme.textTheme.bodyMedium?.copyWith(
        color: willCancel ? palette.textTertiary : palette.textPrimary,
      ),
    );

    // 两种录音态都给同一组可见退路：取消 + 计时 + 停止。
    // 上滑 56pt 只是快捷方式，不是唯一路径（WCAG 2.5.1，0006 §3）。
    return SizedBox(
      height: 56,
      child: Row(
        children: [
          const SizedBox(width: DreamSpacing.sm),
          dot,
          const SizedBox(width: DreamSpacing.sm),
          Flexible(child: label),
          const SizedBox(width: DreamSpacing.xs),
          Text(
            _clock(seconds),
            style: theme.textTheme.bodySmall?.copyWith(
              color: willCancel ? palette.textTertiary : palette.textSecondary,
            ),
          ),
          const Spacer(),
          IconButton(
            tooltip: '取消录音',
            onPressed: onCancel,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            icon: Icon(
              Icons.close_rounded,
              size: 22,
              color: palette.textSecondary,
            ),
          ),
          IconButton(
            tooltip: '停止录音',
            onPressed: onStop,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            icon: Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: theme.colorScheme.primary,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.stop_rounded,
                size: 20,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
