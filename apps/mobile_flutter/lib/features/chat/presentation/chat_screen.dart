import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/app_scope.dart';
import '../../../core/models.dart' hide PromptSuggestion;
import '../../../core/tree.dart';
import '../../../design/context_extension.dart';
import '../../../design/tokens.dart';
import '../../../shared/widgets/dream_mark.dart';
import '../../attach/attach_controller.dart';
import '../../attach/widgets/attach_panel.dart';
import '../../voice/voice_controller.dart';
import '../../voice/widgets/voice_input_button.dart';
import '../chat_controller.dart';
import '../widgets/composer.dart';
import '../widgets/empty_state.dart';
import '../widgets/message_list.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, this.controller});

  /// 聊天控制器。为 null 时回退到 P0 空态骨架（保持 `const ChatScreen()` 可被
  /// 路由直接构造）；集成时由外层注入真实 [ChatController]。
  final ChatController? controller;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  bool _canSend = false;
  AttachController? _attachController;
  VoiceController? _voiceController;
  bool _webSearch = false;

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

  ChatController? get _chat => widget.controller;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_syncCanSend);
    _chat?.addListener(_onChatChanged);
    final chat = _chat;
    if (chat != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        chat.load();
        _maybeShowAnnouncement();
      });
    }
  }

  /// 登录后展示一次服务端公告；失败静默，不影响聊天。
  Future<void> _maybeShowAnnouncement() async {
    final services = AppScope.maybeOf(context);
    if (services == null) return;
    try {
      final notice = await services.api.getAnnouncement();
      if (notice == null || !mounted) return;
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getString('dream-announcement-seen') == notice.id) return;
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(notice.title.isEmpty ? '公告' : notice.title),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 360),
            child: SingleChildScrollView(child: Text(notice.body)),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('知道了'),
            ),
          ],
        ),
      );
      await prefs.setString('dream-announcement-seen', notice.id);
    } catch (_) {
      // 公告拉取失败不阻塞聊天。
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_attachController != null) return;
    final services = AppScope.maybeOf(context);
    if (services == null) return;
    _attachController = AttachController(api: services.api);
    _voiceController = VoiceController(
      api: services.api,
      session: services.store,
    );
  }

  @override
  void dispose() {
    _attachController?.dispose();
    _voiceController?.dispose();
    _controller.removeListener(_syncCanSend);
    _chat?.removeListener(_onChatChanged);
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

  void _onChatChanged() {
    if (mounted) setState(() {});
  }

  void _pick(String prompt) {
    _controller.value = TextEditingValue(
      text: prompt,
      selection: TextSelection.collapsed(offset: prompt.length),
    );
    _focusNode.requestFocus();
  }

  void _send(String text) {
    final chat = _chat;
    if (chat == null) {
      // P0 回退：不真实发送，仅提示。
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(content: Text('P0 骨架：发送将在 P1 接入 Dream SSE（内容未上传）')),
        );
      return;
    }
    final files = _attachController?.selectedIds.toList() ?? const <String>[];
    chat.sendMessage(text, files: files, webSearch: _webSearch);
    _attachController?.clearSelection();
  }

  Future<void> _attach() async {
    final attach = _attachController;
    if (attach == null) return;
    await attach.load();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.only(bottom: DreamSpacing.md),
          child: AttachPanel(controller: attach, allowSelect: true),
        ),
      ),
    );
    if (mounted) setState(() {});
  }

  void _fillFromVoice(String text) {
    final existing = _controller.text.trim();
    final merged = existing.isEmpty ? text : '$existing $text';
    _controller.value = TextEditingValue(
      text: merged,
      selection: TextSelection.collapsed(offset: merged.length),
    );
    _focusNode.requestFocus();
  }

  Future<void> _deleteConversation() async {
    final chat = _chat;
    final id = chat?.activeId;
    if (chat == null || id == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除会话'),
        content: const Text('删除后将无法恢复，确定删除当前会话吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await chat.removeConversation(id);
    }
  }

  Future<void> _showConversations() async {
    final chat = _chat;
    if (chat == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListenableBuilder(
          listenable: chat,
          builder: (context, _) {
            final palette = context.dreamPalette;
            final items = chat.conversations;
            return ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * 0.72,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      DreamSpacing.lg,
                      0,
                      DreamSpacing.md,
                      DreamSpacing.sm,
                    ),
                    child: Row(
                      children: [
                        Text(
                          '会话',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const Spacer(),
                        TextButton.icon(
                          onPressed: () {
                            chat.newConversation();
                            Navigator.of(context).pop();
                          },
                          icon: const Icon(Icons.add_rounded, size: 18),
                          label: const Text('新对话'),
                        ),
                      ],
                    ),
                  ),
                  if (items.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(DreamSpacing.lg),
                      child: Text(
                        '还没有会话',
                        style: Theme.of(context).textTheme.bodyMedium
                            ?.copyWith(color: palette.textTertiary),
                      ),
                    )
                  else
                    Flexible(
                      child: ListView.builder(
                        shrinkWrap: true,
                        itemCount: items.length,
                        itemBuilder: (context, index) {
                          final item = items[index];
                          final selected = item.id == chat.activeId;
                          return ListTile(
                            dense: true,
                            selected: selected,
                            selectedTileColor: palette.brandSoft,
                            title: Text(
                              item.title.isEmpty ? '未命名会话' : item.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            onTap: () {
                              chat.openConversation(item.id);
                              Navigator.of(context).pop();
                            },
                            trailing: IconButton(
                              tooltip: '删除会话',
                              icon: const Icon(
                                Icons.delete_outline_rounded,
                                size: 18,
                              ),
                              onPressed: () async {
                                final ok = await showDialog<bool>(
                                  context: context,
                                  builder: (context) => AlertDialog(
                                    title: const Text('删除会话'),
                                    content: const Text('删除后将无法恢复，确定删除吗？'),
                                    actions: [
                                      TextButton(
                                        onPressed: () =>
                                            Navigator.of(context).pop(false),
                                        child: const Text('取消'),
                                      ),
                                      TextButton(
                                        onPressed: () =>
                                            Navigator.of(context).pop(true),
                                        child: const Text('删除'),
                                      ),
                                    ],
                                  ),
                                );
                                if (ok == true) {
                                  await chat.removeConversation(item.id);
                                }
                              },
                            ),
                          );
                        },
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  void _retryLast() {
    final chat = _chat;
    if (chat == null) return;
    final lastAssistant = _lastAssistantId(chat);
    if (lastAssistant != null) {
      chat.regenerate(lastAssistant);
    }
  }

  Future<void> _editMessage(String messageId) async {
    final chat = _chat;
    if (chat == null) return;
    String current = '';
    for (final m in chat.allMessages) {
      if (m.id == messageId) {
        current = m.content;
        break;
      }
    }
    final result = await showDialog<String>(
      context: context,
      builder: (context) {
        final c = TextEditingController(text: current);
        return AlertDialog(
          title: const Text('编辑消息'),
          content: TextField(
            controller: c,
            autofocus: true,
            minLines: 1,
            maxLines: 6,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(c.text),
              child: const Text('保存'),
            ),
          ],
        );
      },
    );
    if (result != null && result.trim().isNotEmpty) {
      await chat.editMessage(messageId, result.trim());
    }
  }

  String? _lastAssistantId(ChatController chat) {
    for (final m in chat.allMessages.reversed) {
      if (m.role == ChatRole.assistant) return m.id;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final glow = theme.brightness == Brightness.dark ? 0.08 : 0.05;

    final chat = _chat;
    final messages = chat?.visibleMessages ?? const <Message>[];
    final versions = chat != null ? buildVersions(chat.allMessages) : null;
    final streaming = chat?.streaming ?? false;
    final streamError = chat?.streamError;

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
                  _TopBar(
                    onSettings: () => context.push('/settings'),
                    onConversations: chat == null ? null : _showConversations,
                    webSearch: _webSearch,
                    onToggleWebSearch: () {
                      setState(() => _webSearch = !_webSearch);
                    },
                    onDelete: chat != null && chat.activeId != null
                        ? _deleteConversation
                        : null,
                  ),
                  Expanded(
                    child: messages.isEmpty
                        ? ChatEmptyState(prompts: _prompts, onPromptTap: _pick)
                        : MessageList(
                            messages: messages,
                            versions: versions,
                            onEdit: _editMessage,
                            onRegenerate: _chat?.regenerate,
                            onVersionSelect: _chat?.selectMessageVersion,
                          ),
                  ),
                  if (streamError != null)
                    _ErrorBar(text: streamError, onRetry: _retryLast),
                  if (streaming) _StopBar(onStop: chat!.stop),
                  if (_attachController != null &&
                      _attachController!.selectedIds.isNotEmpty)
                    _AttachedBar(controller: _attachController!),
                  Composer(
                    controller: _controller,
                    focusNode: _focusNode,
                    canSend: _canSend && !streaming,
                    onSend: _send,
                    onAttach: _attach,
                    trailing: _voiceController == null
                        ? null
                        : VoiceInputButton(
                            controller: _voiceController!,
                            enabled: !streaming,
                            onResult: _fillFromVoice,
                            onError: (message) {
                              ScaffoldMessenger.of(context)
                                ..hideCurrentSnackBar()
                                ..showSnackBar(
                                  SnackBar(content: Text(message)),
                                );
                            },
                          ),
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
  const _TopBar({
    required this.onSettings,
    this.onConversations,
    this.webSearch = false,
    this.onToggleWebSearch,
    this.onDelete,
  });

  final VoidCallback onSettings;
  final VoidCallback? onConversations;
  final bool webSearch;
  final VoidCallback? onToggleWebSearch;
  final VoidCallback? onDelete;

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
          if (onToggleWebSearch != null)
            IconButton(
              tooltip: webSearch ? '关闭联网搜索' : '联网搜索',
              onPressed: onToggleWebSearch,
              icon: Icon(
                webSearch ? Icons.public_rounded : Icons.public_off_rounded,
                size: 20,
                color: webSearch ? Theme.of(context).colorScheme.primary : null,
              ),
            ),
          if (onConversations != null)
            IconButton(
              tooltip: '会话列表',
              onPressed: onConversations,
              icon: const Icon(Icons.forum_outlined, size: 20),
            ),
          if (onDelete != null)
            IconButton(
              tooltip: '删除会话',
              onPressed: onDelete,
              icon: const Icon(Icons.delete_outline_rounded, size: 20),
            ),
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

class _ErrorBar extends StatelessWidget {
  const _ErrorBar({required this.text, required this.onRetry});

  final String text;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final palette = context.dreamPalette;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DreamSpacing.md,
        DreamSpacing.xs,
        DreamSpacing.md,
        0,
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: DreamSpacing.sm,
          vertical: DreamSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: palette.brandSoft,
          borderRadius: BorderRadius.circular(DreamRadius.sm),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                text,
                style: Theme.of(context).textTheme.bodySmall
                    ?.copyWith(color: palette.textSecondary),
              ),
            ),
            TextButton(onPressed: onRetry, child: const Text('重试')),
          ],
        ),
      ),
    );
  }
}

class _StopBar extends StatelessWidget {
  const _StopBar({required this.onStop});

  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.center,
      child: TextButton.icon(
        onPressed: onStop,
        icon: const Icon(Icons.stop_rounded, size: 18),
        label: const Text('停止生成'),
      ),
    );
  }
}

/// 输入区上方的已选附件条：显示名称、可单个移除。
class _AttachedBar extends StatelessWidget {
  const _AttachedBar({required this.controller});

  final AttachController controller;

  @override
  Widget build(BuildContext context) {
    final palette = context.dreamPalette;
    final selected = controller.files
        .where((f) => controller.selectedIds.contains(f.id))
        .toList();
    if (selected.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DreamSpacing.md,
        0,
        DreamSpacing.md,
        DreamSpacing.xs,
      ),
      child: Wrap(
        spacing: DreamSpacing.xs,
        runSpacing: DreamSpacing.xxs,
        children: [
          for (final file in selected)
            InputChip(
              label: Text(
                file.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              onDeleted: () => controller.toggleSelected(file.id),
              deleteIcon: const Icon(Icons.close_rounded, size: 14),
              visualDensity: VisualDensity.compact,
              side: BorderSide(color: palette.border),
              backgroundColor: palette.composer,
            ),
        ],
      ),
    );
  }
}
