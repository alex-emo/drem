import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../../../design/context_extension.dart';
import '../../../../design/dream_theme.dart';
import '../../../../design/tokens.dart';

/// 轻量流式 markdown 渲染器（不依赖 flutter_markdown）。
///
/// 支持：
/// - 行内：粗体 `**x**`、斜体 `*x*`、行内代码 `` `x` ``、链接 `[t](u)`；
/// - 块级：`#`~`####` 标题、`` ``` `` 代码块（等宽+背景+复制）、
///   无序 `- ` / 有序 `1. ` 列表、`>` 引用、`|` 表格；
///
/// 流式友好：每次全量重排（无增量），可传 [trailing] 在末尾行内追加光标。
class DreamMarkdown extends StatelessWidget {
  const DreamMarkdown({
    super.key,
    required this.text,
    this.trailing,
    this.isUser = false,
  });

  final String text;
  final Widget? trailing;
  final bool isUser;

  @override
  Widget build(BuildContext context) {
    final blocks = _parseBlocksCached(text);
    final children = <Widget>[];
    for (var i = 0; i < blocks.length; i++) {
      final isLast = i == blocks.length - 1;
      if (i > 0) children.add(const SizedBox(height: DreamSpacing.xs));
      children.add(_renderBlock(context, blocks[i], isLast: isLast));
    }
    if (children.isEmpty && trailing != null) {
      children.add(
        RichText(
          text: TextSpan(children: [WidgetSpan(child: trailing!)]),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: children,
    );
  }

  // ---------------------------------------------------------------------------
  // 块级渲染
  // ---------------------------------------------------------------------------

  Widget _renderBlock(
    BuildContext context,
    _MdBlock block, {
    required bool isLast,
  }) {
    final palette = context.dreamPalette;
    switch (block) {
      case _Heading(:final level, :final text):
        return _renderHeading(context, level, text);
      case _Paragraph(:final text):
        return _renderParagraph(context, palette, text, appendTrailing: isLast);
      case _CodeBlock(:final code, :final language):
        return _CodeBlockView(code: code, language: language, palette: palette);
      case _Blockquote(:final text):
        return _BlockquoteView(text: text, palette: palette);
      case _ListBlock(:final ordered, :final items):
        return _ListView(ordered: ordered, items: items, palette: palette);
      case _TableBlock(:final rows):
        return _TableView(rows: rows, palette: palette);
    }
  }

  Widget _renderHeading(BuildContext context, int level, String text) {
    final style = switch (level) {
      1 => Theme.of(context).textTheme.headlineSmall,
      2 => Theme.of(context).textTheme.titleLarge,
      3 => Theme.of(context).textTheme.titleMedium,
      _ => Theme.of(context).textTheme.titleSmall,
    };
    final spans = _parseInline(text, _InlineStyle.fromContext(context));
    return Padding(
      padding: const EdgeInsets.only(
        top: DreamSpacing.sm,
        bottom: DreamSpacing.xs,
      ),
      child: Text.rich(
        TextSpan(children: spans),
        style: style?.copyWith(fontWeight: FontWeight.w600),
      ),
    );
  }

  Widget _renderParagraph(
    BuildContext context,
    DreamPalette palette,
    String text, {
    required bool appendTrailing,
  }) {
    final style = _InlineStyle.fromContext(context);
    final spans = _parseInline(text, style);
    if (appendTrailing && trailing != null) {
      spans.add(
        WidgetSpan(child: trailing!, alignment: PlaceholderAlignment.middle),
      );
    }
    return Text.rich(TextSpan(children: spans));
  }
}

// ---------------------------------------------------------------------------
// 块模型
// ---------------------------------------------------------------------------

sealed class _MdBlock {
  const _MdBlock();
}

class _Heading extends _MdBlock {
  const _Heading(this.level, this.text);
  final int level;
  final String text;
}

class _Paragraph extends _MdBlock {
  const _Paragraph(this.text);
  final String text;
}

class _CodeBlock extends _MdBlock {
  const _CodeBlock(this.language, this.code);
  final String language;
  final String code;
}

class _Blockquote extends _MdBlock {
  const _Blockquote(this.text);
  final String text;
}

class _ListBlock extends _MdBlock {
  const _ListBlock(this.ordered, this.items);
  final bool ordered;
  final List<String> items;
}

class _TableBlock extends _MdBlock {
  const _TableBlock(this.rows);
  final List<List<String>> rows;
}

// ---------------------------------------------------------------------------
// 块级解析
// ---------------------------------------------------------------------------

const int _blockCacheLimit = 24;
final Map<String, List<_MdBlock>> _blockCache = <String, List<_MdBlock>>{};

/// 流式场景下同一段历史文本会被反复 build；按全文缓存解析结果。
List<_MdBlock> _parseBlocksCached(String text) {
  final cached = _blockCache.remove(text);
  if (cached != null) {
    _blockCache[text] = cached; // 触达即刷新 LRU 顺序。
    return cached;
  }
  final blocks = _parseBlocks(text);
  _blockCache[text] = blocks;
  if (_blockCache.length > _blockCacheLimit) {
    _blockCache.remove(_blockCache.keys.first);
  }
  return blocks;
}

List<_MdBlock> _parseBlocks(String text) {
  final lines = text.split('\n');
  final blocks = <_MdBlock>[];
  var i = 0;

  bool isCodeFence(String line) => line.trimLeft().startsWith('```');
  bool isHeading(String line) =>
      RegExp(r'^#{1,4}\s+').hasMatch(line.trimLeft());
  bool isBlockquote(String line) => line.trimLeft().startsWith('>');
  bool isUnordered(String line) => RegExp(r'^\s*[-*+]\s+').hasMatch(line);
  bool isOrdered(String line) => RegExp(r'^\s*\d+\.\s+').hasMatch(line);
  bool isTable(String line) => line.trimLeft().startsWith('|');
  bool isBlockStart(String line) =>
      isCodeFence(line) ||
      isHeading(line) ||
      isBlockquote(line) ||
      isUnordered(line) ||
      isOrdered(line) ||
      isTable(line);

  while (i < lines.length) {
    final line = lines[i];

    if (isCodeFence(line)) {
      final buf = <String>[];
      final language = line.trimLeft().substring(3).trim();
      i++;
      while (i < lines.length && !isCodeFence(lines[i])) {
        buf.add(lines[i]);
        i++;
      }
      i++; // 跳过闭合 ```
      blocks.add(_CodeBlock(language, buf.join('\n')));
      continue;
    }

    if (isHeading(line)) {
      final m = RegExp(r'^(#{1,4})\s+(.*)$').firstMatch(line.trimLeft())!;
      blocks.add(_Heading(m.group(1)!.length, m.group(2)!));
      i++;
      continue;
    }

    if (isBlockquote(line)) {
      final buf = <String>[];
      while (i < lines.length && lines[i].trimLeft().startsWith('>')) {
        buf.add(lines[i].trimLeft().substring(1).trim());
        i++;
      }
      blocks.add(_Blockquote(buf.join('\n')));
      continue;
    }

    if (isUnordered(line)) {
      final items = <String>[];
      while (i < lines.length) {
        final m = RegExp(r'^\s*[-*+]\s+(.*)$').firstMatch(lines[i]);
        if (m == null) break;
        items.add(m.group(1)!);
        i++;
      }
      blocks.add(_ListBlock(false, items));
      continue;
    }

    if (isOrdered(line)) {
      final items = <String>[];
      while (i < lines.length) {
        final m = RegExp(r'^\s*\d+\.\s+(.*)$').firstMatch(lines[i]);
        if (m == null) break;
        items.add(m.group(1)!);
        i++;
      }
      blocks.add(_ListBlock(true, items));
      continue;
    }

    if (isTable(line)) {
      final rows = <List<String>>[];
      while (i < lines.length && lines[i].trimLeft().startsWith('|')) {
        rows.add(_parseTableRow(lines[i]));
        i++;
      }
      blocks.add(_TableBlock(rows));
      continue;
    }

    if (line.trim().isNotEmpty) {
      final buf = <String>[line];
      i++;
      while (i < lines.length &&
          lines[i].trim().isNotEmpty &&
          !isBlockStart(lines[i])) {
        buf.add(lines[i]);
        i++;
      }
      blocks.add(_Paragraph(buf.join('\n')));
      continue;
    }

    i++;
  }

  return blocks;
}

List<String> _parseTableRow(String line) {
  var s = line.trim();
  if (s.startsWith('|')) s = s.substring(1);
  if (s.endsWith('|')) s = s.substring(0, s.length - 1);
  return s.split('|').map((e) => e.trim()).toList();
}

// ---------------------------------------------------------------------------
// 行内解析
// ---------------------------------------------------------------------------

class _InlineStyle {
  const _InlineStyle({
    required this.base,
    required this.bold,
    required this.italic,
    required this.code,
    required this.link,
  });

  final TextStyle base;
  final TextStyle bold;
  final TextStyle italic;
  final TextStyle code;
  final TextStyle link;

  factory _InlineStyle.fromContext(BuildContext context) {
    final palette = context.dreamPalette;
    final base = TextStyle(
      color: palette.textPrimary,
      fontSize: 15,
      height: 1.55,
    );
    final primary = Theme.of(context).colorScheme.primary;
    return _InlineStyle(
      base: base,
      bold: base.copyWith(fontWeight: FontWeight.w700),
      italic: base.copyWith(fontStyle: FontStyle.italic),
      code: base.copyWith(
        fontFamily: 'monospace',
        fontSize: 13.5,
        backgroundColor: palette.code,
      ),
      link: base.copyWith(color: primary, decoration: TextDecoration.underline),
    );
  }
}

List<InlineSpan> _parseInline(String text, _InlineStyle style) {
  final spans = <InlineSpan>[];
  final buf = StringBuffer();
  var i = 0;

  void flush() {
    if (buf.isNotEmpty) {
      spans.add(TextSpan(text: buf.toString(), style: style.base));
      buf.clear();
    }
  }

  while (i < text.length) {
    final ch = text[i];

    if (ch == '`') {
      final end = text.indexOf('`', i + 1);
      if (end != -1) {
        flush();
        spans.add(
          TextSpan(text: text.substring(i + 1, end), style: style.code),
        );
        i = end + 1;
        continue;
      }
    }

    if (ch == '*' && i + 1 < text.length && text[i + 1] == '*') {
      final end = text.indexOf('**', i + 2);
      if (end != -1) {
        flush();
        spans.add(
          TextSpan(text: text.substring(i + 2, end), style: style.bold),
        );
        i = end + 2;
        continue;
      }
    }

    if (ch == '*' && i + 1 < text.length && text[i + 1] != '*') {
      final end = text.indexOf('*', i + 1);
      if (end != -1) {
        flush();
        spans.add(
          TextSpan(text: text.substring(i + 1, end), style: style.italic),
        );
        i = end + 1;
        continue;
      }
    }

    if (ch == '[') {
      final close = text.indexOf(']', i + 1);
      if (close != -1 && close + 1 < text.length && text[close + 1] == '(') {
        final paren = text.indexOf(')', close + 2);
        if (paren != -1) {
          flush();
          spans.add(
            TextSpan(text: text.substring(i + 1, close), style: style.link),
          );
          i = paren + 1;
          continue;
        }
      }
    }

    buf.write(ch);
    i++;
  }

  flush();
  return spans;
}

// ---------------------------------------------------------------------------
// 块级视图
// ---------------------------------------------------------------------------

class _CodeBlockView extends StatelessWidget {
  const _CodeBlockView({
    required this.code,
    required this.language,
    required this.palette,
  });

  final String code;
  final String language;
  final DreamPalette palette;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: DreamSpacing.xs),
      padding: const EdgeInsets.all(DreamSpacing.sm),
      decoration: BoxDecoration(
        color: palette.code,
        borderRadius: BorderRadius.circular(DreamRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (language.isNotEmpty)
                Text(
                  language,
                  style: TextStyle(
                    color: palette.textTertiary,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  ),
                ),
              const Spacer(),
              IconButton(
                tooltip: '复制',
                visualDensity: VisualDensity.compact,
                iconSize: 16,
                color: palette.textTertiary,
                icon: const Icon(Icons.copy_rounded),
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: code));
                  ScaffoldMessenger.of(context)
                      .showSnackBar(const SnackBar(content: Text('已复制')));
                },
              ),
            ],
          ),
          Text(
            code,
            style: TextStyle(
              color: palette.textPrimary,
              fontSize: 13.5,
              height: 1.5,
              fontFamily: 'monospace',
            ),
          ),
        ],
      ),
    );
  }
}

class _BlockquoteView extends StatelessWidget {
  const _BlockquoteView({required this.text, required this.palette});

  final String text;
  final DreamPalette palette;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: DreamSpacing.xs),
      padding: const EdgeInsets.only(left: DreamSpacing.sm),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(
            color: Theme.of(context).colorScheme.primary,
            width: 3,
          ),
        ),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: palette.textSecondary,
          fontSize: 14.5,
          height: 1.55,
        ),
      ),
    );
  }
}

class _ListView extends StatelessWidget {
  const _ListView({
    required this.ordered,
    required this.items,
    required this.palette,
  });

  final bool ordered;
  final List<String> items;
  final DreamPalette palette;

  @override
  Widget build(BuildContext context) {
    final style = _InlineStyle.fromContext(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DreamSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < items.length; i++)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 20,
                  child: Text(
                    ordered ? '${i + 1}.' : '•',
                    style: TextStyle(
                      color: palette.textTertiary,
                      fontSize: 15,
                      height: 1.55,
                    ),
                  ),
                ),
                Expanded(
                  child: Text.rich(
                    TextSpan(children: _parseInline(items[i], style)),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _TableView extends StatelessWidget {
  const _TableView({required this.rows, required this.palette});

  final List<List<String>> rows;
  final DreamPalette palette;

  @override
  Widget build(BuildContext context) {
    final style = _InlineStyle.fromContext(context);
    // 跳过纯分隔行（| --- | --- |）。
    final data = rows.where((r) => !_isSeparator(r)).toList();
    if (data.isEmpty) return const SizedBox.shrink();

    final columns = data.map((r) => r.length).fold(0, (a, b) => a > b ? a : b);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: DreamSpacing.xs),
      decoration: BoxDecoration(
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(DreamRadius.sm),
      ),
      child: Column(
        children: [
          for (var ri = 0; ri < data.length; ri++)
            Container(
              decoration: BoxDecoration(
                border: Border(
                  bottom: ri == data.length - 1
                      ? BorderSide.none
                      : BorderSide(color: palette.border),
                ),
              ),
              child: Row(
                children: [
                  for (var ci = 0; ci < columns; ci++)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.all(DreamSpacing.xs),
                        child: Text.rich(
                          TextSpan(
                            children: _parseInline(
                              ci < data[ri].length ? data[ri][ci] : '',
                              style,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  bool _isSeparator(List<String> row) =>
      row.every((c) => c.isEmpty || RegExp(r'^:?-+:?$').hasMatch(c));
}
