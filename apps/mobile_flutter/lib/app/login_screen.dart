import 'package:material_ui/material_ui.dart';

import '../design/context_extension.dart';
import '../design/tokens.dart';
import '../shared/widgets/dream_mark.dart';
import '../shared/widgets/pressable_scale.dart';
import 'session_controller.dart';

/// 登录 / 注册。视觉延续 Quiet Instrument：单列、编辑式标题、发丝线输入。
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.controller});

  final SessionController controller;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _displayName = TextEditingController();
  bool _register = false;
  bool _obscure = true;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _displayName.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final username = _username.text.trim();
    final password = _password.text;
    if (username.isEmpty || password.isEmpty) return;
    FocusScope.of(context).unfocus();
    if (_register) {
      await widget.controller.register(
        username,
        password,
        displayName: _displayName.text.trim().isEmpty
            ? null
            : _displayName.text.trim(),
      );
    } else {
      await widget.controller.login(username, password);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.dreamPalette;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(
              horizontal: DreamSpacing.pageMargin,
              vertical: DreamSpacing.xxl,
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: ListenableBuilder(
                listenable: widget.controller,
                builder: (context, _) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const DreamMark(size: 44),
                      const SizedBox(height: DreamSpacing.xxl),
                      Text(
                        _register ? '创建 Dream 账号' : '欢迎回来',
                        style: Theme.of(context).textTheme.displaySmall,
                      ),
                      const SizedBox(height: DreamSpacing.sm),
                      Text(
                        _register ? '注册后即可同步加密备份。' : '登录后继续你的对话。',
                        style: Theme.of(context).textTheme.bodyMedium
                            ?.copyWith(color: palette.textSecondary),
                      ),
                      const SizedBox(height: DreamSpacing.xl),
                      if (_register) ...[
                        _Field(
                          controller: _displayName,
                          hint: '昵称（可选）',
                          textInputAction: TextInputAction.next,
                        ),
                        const SizedBox(height: DreamSpacing.md),
                      ],
                      _Field(
                        controller: _username,
                        hint: '用户名',
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: DreamSpacing.md),
                      _Field(
                        controller: _password,
                        hint: '密码',
                        obscure: _obscure,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _submit(),
                        suffix: IconButton(
                          tooltip: _obscure ? '显示密码' : '隐藏密码',
                          icon: Icon(
                            _obscure ? Icons.visibility_off : Icons.visibility,
                            size: 20,
                            color: palette.textTertiary,
                          ),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      if (widget.controller.error != null) ...[
                        const SizedBox(height: DreamSpacing.md),
                        Text(
                          widget.controller.error!,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: Theme.of(context).colorScheme.error,
                              ),
                        ),
                      ],
                      const SizedBox(height: DreamSpacing.xl),
                      SizedBox(
                        width: double.infinity,
                        child: PressableScale(
                          child: FilledButton(
                            onPressed: widget.controller.busy ? null : _submit,
                            style: FilledButton.styleFrom(
                              backgroundColor: Theme.of(context)
                                  .colorScheme
                                  .primary,
                              foregroundColor: Colors.white,
                              minimumSize: const Size.fromHeight(50),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(
                                  DreamRadius.md,
                                ),
                              ),
                            ),
                            child: widget.controller.busy
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : Text(_register ? '注册并登录' : '登录'),
                          ),
                        ),
                      ),
                      const SizedBox(height: DreamSpacing.md),
                      Center(
                        child: TextButton(
                          onPressed: widget.controller.busy
                              ? null
                              : () => setState(() => _register = !_register),
                          child: Text(
                            _register ? '已有账号？去登录' : '没有账号？注册',
                            style: TextStyle(color: palette.textSecondary),
                          ),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.hint,
    this.obscure = false,
    this.textInputAction,
    this.onSubmitted,
    this.suffix,
  });

  final TextEditingController controller;
  final String hint;
  final bool obscure;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final Widget? suffix;

  @override
  Widget build(BuildContext context) {
    final palette = context.dreamPalette;
    return TextField(
      controller: controller,
      obscureText: obscure,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted,
      style: Theme.of(context).textTheme.bodyLarge,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: palette.textTertiary),
        filled: true,
        fillColor: palette.composer,
        suffixIcon: suffix,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: DreamSpacing.lg,
          vertical: DreamSpacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DreamRadius.md),
          borderSide: BorderSide(color: palette.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DreamRadius.md),
          borderSide: BorderSide(color: palette.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DreamRadius.md),
          borderSide: BorderSide(
            color: Theme.of(context).colorScheme.primary,
            width: 1.4,
          ),
        ),
      ),
    );
  }
}
