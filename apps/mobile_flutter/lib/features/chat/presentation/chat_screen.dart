import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../design/tokens.dart';
import '../../../shared/widgets/dream_mark.dart';
import '../widgets/chat_message.dart';
import '../widgets/composer.dart';
import '../widgets/empty_state.dart';
import '../widgets/message_list.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  /// P0 无真实消息：空列表触发空态；P1 接入 Dream SSE 后填充。
  final List<ChatMessage> _messages = [];

  bool _canSend = false;

  static const List<PromptSuggestion> _prompts = [
    PromptSuggestion(
      title: '写一段自我介绍',
      subtitle: '社交主页 · 三句话版本',
      fill: '帮我写一段简洁的自我介绍，三句话以内，语气自然一点。',
    ),
    PromptSuggestion(
      title: '解释一段代码',
      subtitle: '贴代码，讲清逻辑与边界',
      fill: '解释下面这段代码的逻辑、时间复杂度和边界情况：\n\n',
    ),
    PromptSuggestion(
      title: '翻译并润色',
      subtitle: '保留语气，不像机翻',
      fill: '把下面这段话翻译成英文，保留原来的语气，不要像机器翻译：\n\n',
    ),
    PromptSuggestion(
      title: '规划周末旅行',
      subtitle: '两天一夜，松弛一点',
      fill: '帮我规划一个两天一夜的周末旅行，节奏松弛一点，给出路线和预算。',
    ),
  ];

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

  void _send(String text) {
    // Composer 内部已做 mediumImpact + 清空 + 保持焦点，这里只给 P0 提示，
    // 不重复触感，避免发送时二次震动。
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(content: Text('P0 骨架：发送将在 P1 接入 Dream SSE（内容未上传）')),
      );
  }

  void _attach() {
    // Composer 内置 P1 占位：selectionClick 触感 + 「附件将在 P1 接入」提示。
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
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
                  Expanded(
                    child: _messages.isEmpty
                        ? ChatEmptyState(prompts: _prompts, onPromptTap: _pick)
                        : MessageList(messages: _messages),
                  ),
                  Composer(
                    controller: _controller,
                    focusNode: _focusNode,
                    canSend: _canSend,
                    onSend: _send,
                    onAttach: _attach,
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
