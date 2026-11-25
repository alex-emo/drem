import 'dart:async';

import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/app_scope.dart';
import '../../../core/models.dart' hide PromptSuggestion;
import '../../../core/tree.dart';
import '../../../design/context_extension.dart';
import '../../../design/tokens.dart';
import '../../../shared/widgets/dream_mark.dart';
import '../../../shared/widgets/pressable_scale.dart';
import '../../attach/attach_controller.dart';
import '../../attach/widgets/attach_panel.dart';
import '../../voice/voice_controller.dart';
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
  final ScrollController _scrollController = ScrollController();

  bool _canSend = false;
  bool _stickToBottom = true;
  bool _showJumpToBottom = false;
  AttachController? _attachController;
  VoiceController? _voiceController;
  bool _webSearch = false;
  bool _deepThinking = false;

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
    _scrollController.addListener(_onScrollChanged);
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
    _scrollController.removeListener(_onScrollChanged);
    _scrollController.dispose();
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
    if (!mounted) return;
    setState(() {});
    if (_stickToBottom) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _followBottom());
    }
  }

  void _onScrollChanged() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    final distance = position.maxScrollExtent - position.pixels;
    _stickToBottom = distance < 80;
    final next = distance > 240;
    if (next != _showJumpToBottom) {
      setState(() => _showJumpToBottom = next);
    }
  }

  /// 贴底时跟随内容增长；不做每帧动画，避免和 30ms 流式 tick 打架。
  void _followBottom() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if ((position.maxScrollExtent - position.pixels).abs() < 2) return;
    _scrollController.jumpTo(position.maxScrollExtent);
  }

  void _jumpToBottom() {
    if (!_scrollController.hasClients) return;
    HapticFeedback.selectionClick();
    _scrollController.animateTo(
      _scrollController.position.maxScrollExtent,
      duration: DreamMotion.pageOut,
      curve: DreamMotion.standard,
    );
    setState(() {
      _stickToBottom = true;
      _showJumpToBottom = false;
    });
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
    HapticFeedback.mediumImpact();
    final files = _attachController?.selectedIds.toList() ?? const <String>[];
    chat.deepThinking = _deepThinking;
    chat.sendMessage(text, files: files, webSearch: _webSearch);
    _attachController?.clearSelection();
    _stickToBottom = true;
    WidgetsBinding.instance.addPostFrameCallback((_) => _followBottom());
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

  Future<void> _startVoiceHold() async {
    final voice = _voiceController;
    if (voice == null || _chat?.streaming == true) return;
    try {
      await voice.startRecording();
    } catch (error) {
      if (mounted) _showError('无法开始录音：$error');
    }
  }

  void _endVoiceHold(bool cancel) {
    final voice = _voiceController;
    if (voice == null) return;
    unawaited(_finishVoice(voice, cancel));
  }

  Future<void> _finishVoice(VoiceController voice, bool cancel) async {
    try {
      final path = await voice.stopRecording();
      if (cancel || path == null) return;
      final text = await voice.transcribeFile(path);
      if (!mounted || text.trim().isEmpty) return;
      _fillFromVoice(text);
    } catch (error) {
      if (mounted) _showError('语音转写失败：$error');
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
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

    final chat = _chat;
    final messages = chat?.visibleMessages ?? const <Message>[];
    final versions = chat != null ? buildVersions(chat.allMessages) : null;
    final streaming = chat?.streaming ?? false;
    final streamError = chat?.streamError;

    return Scaffold(
      drawer: chat == null
          ? null
          : _ConversationDrawer(
              chat: chat,
              onSettings: () => context.push('/settings'),
            ),
      drawerEdgeDragWidth: 44,
      body: ColoredBox(
        color: theme.scaffoldBackgroundColor,
        child: SafeArea(
          bottom: false,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 780),
              child: Column(
                children: [
                  _ChatHeader(
                    onSettings: chat == null
                        ? () => context.push('/settings')
                        : null,
                  ),
                  Expanded(
                    child: Stack(
                      children: [
                        if (messages.isEmpty)
                          ChatEmptyState(prompts: _prompts, onPromptTap: _pick)
                        else
                          MessageList(
                            controller: _scrollController,
                            messages: messages,
                            versions: versions,
                            onEdit: _editMessage,
                            onRegenerate: _chat?.regenerate,
                            onVersionSelect: _chat?.selectMessageVersion,
                          ),
                        if (_showJumpToBottom)
                          Positioned(
                            left: 0,
                            right: 0,
                            bottom: DreamSpacing.sm,
                            child: Center(
                              child: _JumpToBottomButton(
                                onTap: _jumpToBottom,
                              ),
                            ),
                          ),
                      ],
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
                    hintText: '轻点输入，长按说话',
                    voiceEnabled: _voiceController != null && !streaming,
                    onVoiceStart: _startVoiceHold,
                    onVoiceEnd: _endVoiceHold,
                    header: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _ModeChip(
                          label: '深度思考',
                          active: _deepThinking,
                          onTap: () =>
                              setState(() => _deepThinking = !_deepThinking),
                        ),
                        const SizedBox(width: DreamSpacing.xs),
                        _ModeChip(
                          label: '联网',
                          active: _webSearch,
                          onTap: () => setState(() => _webSearch = !_webSearch),
                        ),
                      ],
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

class _JumpToBottomButton extends StatelessWidget {
  const _JumpToBottomButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.dreamPalette;
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: DreamSpacing.sm,
          vertical: 7,
        ),
        decoration: BoxDecoration(
          color: palette.composer,
          borderRadius: BorderRadius.circular(DreamRadius.pill),
          border: Border.all(color: palette.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.arrow_downward_rounded,
              size: 15,
              color: palette.textSecondary,
            ),
            const SizedBox(width: 5),
            Text(
              '回到底部',
              style: TextStyle(
                fontSize: 12,
                color: palette.textSecondary,
                height: 1.2,
              ),
            ),
          ],
        ),
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

class _ChatHeader extends StatelessWidget {
  const _ChatHeader({this.onSettings});

  final VoidCallback? onSettings;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = context.dreamPalette;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DreamSpacing.pageMargin,
        DreamSpacing.sm,
        DreamSpacing.pageMargin,
        DreamSpacing.xs,
      ),
      child: Row(
        children: [
          const DreamMark(size: 24),
          const SizedBox(width: DreamSpacing.sm),
          Text(
            'Dream',
            style: theme.textTheme.titleMedium?.copyWith(
              color: palette.textPrimary,
            ),
          ),
          const Spacer(),
          if (onSettings != null)
            IconButton(
              tooltip: '设置',
              onPressed: onSettings,
              icon: const Icon(Icons.tune_rounded, size: 20),
            )
          else
            Text(
              '左滑会话',
              style: theme.textTheme.bodySmall?.copyWith(
                color: palette.textTertiary,
              ),
            ),
        ],
      ),
    );
  }
}

class _ModeChip extends StatelessWidget {
  const _ModeChip({
    required this.label,
    required this.active,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = context.dreamPalette;
    final primary = theme.colorScheme.primary;
    return InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      borderRadius: BorderRadius.circular(DreamRadius.pill),
      child: AnimatedContainer(
        duration: DreamMotion.fast,
        curve: DreamMotion.standard,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: active ? palette.brandSoft : Colors.transparent,
          border: Border.all(
            color: active ? primary.withValues(alpha: 0.45) : palette.border,
          ),
          borderRadius: BorderRadius.circular(DreamRadius.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(
                color: active ? primary : palette.textTertiary,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 5),
            Text(
              label,
              style: theme.textTheme.labelSmall?.copyWith(
                color: active ? primary : palette.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConversationDrawer extends StatelessWidget {
  const _ConversationDrawer({required this.chat, required this.onSettings});

  final ChatController chat;
  final VoidCallback onSettings;

  Future<bool> _confirmDelete(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除会话'),
        content: const Text('删除后将无法恢复，确定删除吗？'),
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
    return ok ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = context.dreamPalette;
    return Drawer(
      width: MediaQuery.sizeOf(context).width * 0.86,
      backgroundColor: palette.sidebar,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.horizontal(right: Radius.circular(20)),
      ),
      child: SafeArea(
        child: ListenableBuilder(
          listenable: chat,
          builder: (context, _) {
            final items = chat.conversations;
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    DreamSpacing.pageMargin,
                    DreamSpacing.sm,
                    DreamSpacing.sm,
                    DreamSpacing.xs,
                  ),
                  child: Row(
                    children: [
                      const DreamMark(size: 24),
                      const SizedBox(width: DreamSpacing.sm),
                      Text('对话', style: theme.textTheme.titleMedium),
                    ],
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.add_rounded, size: 20),
                  title: const Text('新对话'),
                  dense: true,
                  onTap: () {
                    Navigator.of(context).pop();
                    chat.newConversation();
                  },
                ),
                Divider(height: 1, color: palette.border),
                Expanded(
                  child: items.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(DreamSpacing.lg),
                          child: Text(
                            '还没有会话',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: palette.textTertiary,
                            ),
                          ),
                        )
                      : ListView.builder(
                          padding: EdgeInsets.zero,
                          itemCount: items.length,
                          itemBuilder: (context, index) {
                            final item = items[index];
                            return Dismissible(
                              key: ValueKey(item.id),
                              direction: DismissDirection.endToStart,
                              confirmDismiss: (_) => _confirmDelete(context),
                              onDismissed: (_) =>
                                  chat.removeConversation(item.id),
                              background: Container(
                                color: theme.colorScheme.error.withValues(
                                  alpha: 0.16,
                                ),
                                alignment: Alignment.centerRight,
                                padding: const EdgeInsets.only(
                                  right: DreamSpacing.lg,
                                ),
                                child: Icon(
                                  Icons.delete_outline_rounded,
                                  color: theme.colorScheme.error,
                                ),
                              ),
                              child: ListTile(
                                dense: true,
                                selected: item.id == chat.activeId,
                                selectedTileColor: palette.brandSoft,
                                title: Text(
                                  item.title.isEmpty ? '未命名会话' : item.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                onTap: () {
                                  Navigator.of(context).pop();
                                  chat.openConversation(item.id);
                                },
                              ),
                            );
                          },
                        ),
                ),
                Divider(height: 1, color: palette.border),
                ListTile(
                  leading: const Icon(Icons.tune_rounded, size: 20),
                  title: const Text('设置'),
                  dense: true,
                  onTap: () {
                    Navigator.of(context).pop();
                    onSettings();
                  },
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
