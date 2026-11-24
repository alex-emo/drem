import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';
import '../../../shared/widgets/dream_mark.dart';
import '../../../shared/widgets/pressable_scale.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  bool _canSend = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_syncCanSend);
  }

  @override
  void dispose() {
    _controller.removeListener(_syncCanSend);
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _syncCanSend() {
    final next = _controller.text.trim().isNotEmpty;
    if (next != _canSend) {
      setState(() => _canSend = next);
    }
  }

  void _pick(String prompt) {
    _controller.value = TextEditingValue(
      text: prompt,
      selection: TextSelection.collapsed(offset: prompt.length),
    );
    _focusNode.requestFocus();
  }

  void _send() {
    if (!_canSend) {
      return;
    }
    HapticFeedback.mediumImpact();
    _toast('P0 骨架：发送将在 P1 接入 Dream SSE（内容未上传）');
  }

  void _attach() {
    HapticFeedback.selectionClick();
    _toast('P1 接入附件与文件解析');
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final glow = theme.brightness == Brightness.dark ? 0.08 : 0.05;

    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              DreamColors.brand.withValues(alpha: glow),
              DreamColors.brand.withValues(alpha: 0),
            ],
            stops: const [0, 0.55],
          ),
        ),
        child: SafeArea(
          bottom: false,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 780),
              child: Column(
                children: [
                  _TopBar(onSettings: () => context.push('/settings')),
                  Expanded(child: _EmptyState(onPick: _pick)),
                  _Composer(
                    controller: _controller,
                    focusNode: _focusNode,
                    canSend: _canSend,
                    onSend: _send,
                    onAttach: _attach,
                    palette: palette,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onSettings});

  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DreamSpacing.lg,
        DreamSpacing.xs,
        DreamSpacing.sm,
        0,
      ),
      child: Row(
        children: [
          const DreamMark(size: 28),
          const SizedBox(width: DreamSpacing.sm),
          Text('Dream', style: theme.textTheme.titleLarge),
          const Spacer(),
          IconButton(
            tooltip: '设置',
            onPressed: onSettings,
            icon: const Icon(Icons.tune_rounded, size: 20),
          ),
        ],
      ),
    );
  }
}

class _Prompt {
  const _Prompt({
    required this.title,
    required this.subtitle,
    required this.fill,
  });

  final String title;
  final String subtitle;
  final String fill;
}

class _EmptyState extends StatefulWidget {
  const _EmptyState({required this.onPick});

  final ValueChanged<String> onPick;

  @override
  State<_EmptyState> createState() => _EmptyStateState();
}

class _EmptyStateState extends State<_EmptyState>
    with SingleTickerProviderStateMixin {
  static const List<_Prompt> _prompts = [
    _Prompt(
      title: '写一段自我介绍',
      subtitle: '社交主页 · 三句话版本',
      fill: '帮我写一段简洁的自我介绍，三句话以内，语气自然一点。',
    ),
    _Prompt(
      title: '解释一段代码',
      subtitle: '贴代码，讲清逻辑与边界',
      fill: '解释下面这段代码的逻辑、时间复杂度和边界情况：\n\n',
    ),
    _Prompt(
      title: '翻译并润色',
      subtitle: '保留语气，不像机翻',
      fill: '把下面这段话翻译成英文，保留原来的语气，不要像机器翻译：\n\n',
    ),
    _Prompt(
      title: '规划周末旅行',
      subtitle: '两天一夜，松弛一点',
      fill: '帮我规划一个两天一夜的周末旅行，节奏松弛一点，给出路线和预算。',
    ),
  ];

  late final AnimationController _intro;

  @override
  void initState() {
    super.initState();
    _intro = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 620),
    )..forward();
  }

  @override
  void dispose() {
    _intro.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 560;
        final horizontal = compact ? DreamSpacing.lg : 28.0;
        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            horizontal,
            compact ? 36 : 68,
            horizontal,
            20,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Reveal(
                controller: _intro,
                index: 0,
                enabled: !reduceMotion,
                child: Text(
                  '从一个问题开始。',
                  style: theme.textTheme.displaySmall?.copyWith(
                    fontSize: compact ? 30 : 36,
                    height: 1.12,
                    letterSpacing: -1,
                  ),
                ),
              ),
              const SizedBox(height: DreamSpacing.sm),
              _Reveal(
                controller: _intro,
                index: 1,
                enabled: !reduceMotion,
                child: Text(
                  '写下你的问题，Dream 会陪你把它想清楚。',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: palette.textSecondary,
                  ),
                ),
              ),
              SizedBox(height: compact ? 32 : 44),
              Container(height: 1, color: palette.border),
              for (var i = 0; i < _prompts.length; i++) ...[
                _Reveal(
                  controller: _intro,
                  index: 2 + i,
                  enabled: !reduceMotion,
                  child: _PromptRow(
                    index: i + 1,
                    prompt: _prompts[i],
                    onTap: () => widget.onPick(_prompts[i].fill),
                  ),
                ),
                if (i != _prompts.length - 1)
                  Container(height: 1, color: palette.border),
              ],
              const SizedBox(height: DreamSpacing.lg),
              Text(
                'Dream 可能会犯错，请核实重要信息。',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: palette.textTertiary,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Reveal extends StatelessWidget {
  const _Reveal({
    required this.controller,
    required this.index,
    required this.child,
    required this.enabled,
  });

  final AnimationController controller;
  final int index;
  final Widget child;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    if (!enabled) {
      return child;
    }
    final start = (index * 0.06).clamp(0.0, 0.5).toDouble();
    final end = (start + 0.55).clamp(0.0, 1.0).toDouble();
    final animation = CurvedAnimation(
      parent: controller,
      curve: Interval(start, end, curve: DreamMotion.standard),
    );
    return FadeTransition(
      opacity: animation,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.05),
          end: Offset.zero,
        ).animate(animation),
        child: child,
      ),
    );
  }
}

class _PromptRow extends StatelessWidget {
  const _PromptRow({
    required this.index,
    required this.prompt,
    required this.onTap,
  });

  final int index;
  final _Prompt prompt;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = theme.extension<DreamPalette>()!;
    return PressableScale(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 17),
        child: Row(
          children: [
            SizedBox(
              width: 34,
              child: Text(
                index.toString().padLeft(2, '0'),
                style: theme.textTheme.labelMedium?.copyWith(
                  color: theme.colorScheme.primary,
                  letterSpacing: 0.8,
                ),
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(prompt.title, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 3),
                  Text(
                    prompt.subtitle,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: palette.textTertiary,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.north_east_rounded,
              size: 18,
              color: palette.textTertiary,
            ),
          ],
        ),
      ),
    );
  }
}

class _Composer extends StatefulWidget {
  const _Composer({
    required this.controller,
    required this.focusNode,
    required this.canSend,
    required this.onSend,
    required this.onAttach,
    required this.palette,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool canSend;
  final VoidCallback onSend;
  final VoidCallback onAttach;
  final DreamPalette palette;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = widget.palette;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    return Focus(
      onFocusChange: (value) {
        if (value != _focused) {
          setState(() => _focused = value);
        }
      },
      child: AnimatedContainer(
        duration: reduceMotion ? Duration.zero : DreamMotion.fast,
        curve: DreamMotion.standard,
        decoration: BoxDecoration(
          color: palette.composer,
          border: Border(
            top: BorderSide(
              color: _focused
                  ? theme.colorScheme.primary.withValues(alpha: 0.45)
                  : palette.border,
            ),
          ),
        ),
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
        child: SafeArea(
          top: false,
          minimum: const EdgeInsets.only(bottom: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              IconButton(
                tooltip: '附件',
                onPressed: widget.onAttach,
                icon: Icon(Icons.add_rounded, color: palette.textSecondary),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: TextField(
                    controller: widget.controller,
                    focusNode: widget.focusNode,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: palette.textPrimary,
                    ),
                    cursorColor: theme.colorScheme.primary,
                    minLines: 1,
                    maxLines: 5,
                    keyboardType: TextInputType.multiline,
                    textInputAction: TextInputAction.newline,
                    decoration: InputDecoration(
                      hintText: '给 Dream 发送消息',
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
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: PressableScale(
                  onTap: widget.canSend ? widget.onSend : null,
                  child: AnimatedContainer(
                    duration: reduceMotion ? Duration.zero : DreamMotion.fast,
                    curve: DreamMotion.standard,
                    width: 40,
                    height: 40,
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
              ),
            ],
          ),
        ),
      ),
    );
  }
}
