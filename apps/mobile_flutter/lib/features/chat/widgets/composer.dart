import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';

/// 输入区：多行自动增高（1→5 行后内部滚动）、发送清空并保持焦点、
/// 附件 P1 占位、聚焦边框 border→brand（1.5px / 180ms）。
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
    this.trailing,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool canSend;
  final ValueChanged<String> onSend; // 传输入文本
  final VoidCallback onAttach;
  final ValueChanged<bool>? onFocusChanged;
  final String hintText;

  /// 输入框右侧、发送按钮之前的可选控件（如语音输入）。
  final Widget? trailing;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  bool _focused = false;

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
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            IconButton(
              tooltip: '附件',
              onPressed: _handleAttach,
              icon: Icon(Icons.add_rounded, color: palette.textSecondary),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: DreamSpacing.sm),
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
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: palette.textPrimary,
                    ),
                    decoration: InputDecoration(
                      hintText: widget.hintText,
                      hintStyle: theme.textTheme.bodyLarge?.copyWith(
                        color: palette.textTertiary,
                      ),
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
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
              icon: AnimatedContainer(
                duration: reduceMotion ? Duration.zero : DreamMotion.fast,
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
                  color: widget.canSend ? Colors.white : palette.textTertiary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
