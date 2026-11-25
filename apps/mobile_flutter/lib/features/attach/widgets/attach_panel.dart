import 'package:material_ui/material_ui.dart';

import '../../../core/models.dart';
import '../../../design/dream_theme.dart';
import '../../../design/tokens.dart';
import '../attach_controller.dart';

/// 附件选择面板：列表展示、上传按钮、删除、勾选聊天引用。
class AttachPanel extends StatelessWidget {
  const AttachPanel({
    super.key,
    required this.controller,
    this.allowSelect = false,
    this.compact = false,
  });

  /// 复用宿主传入的 controller，由宿主负责 dispose。
  final AttachController controller;
  final bool allowSelect;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<DreamPalette>()!;
    final primary = Theme.of(context).colorScheme.primary;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  '附件',
                  style: TextStyle(
                    color: palette.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                if (controller.uploading)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                IconButton(
                  tooltip: '添加附件',
                  onPressed: controller.uploading ? null : () => _pick(context),
                  icon: Icon(
                    Icons.add,
                    color: controller.uploading
                        ? palette.textTertiary
                        : primary,
                  ),
                ),
              ],
            ),
            if (controller.files.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: DreamSpacing.md),
                child: Text(
                  '暂无附件，点击「+」选择文件（≤ 1 MiB）。',
                  style: TextStyle(color: palette.textTertiary, fontSize: 13),
                ),
              )
            else
              Flexible(child: _buildList(context, palette, primary)),
          ],
        );
      },
    );
  }

  Widget _buildList(BuildContext context, DreamPalette palette, Color primary) {
    final files = controller.files;
    if (compact) {
      return ListView.builder(
        shrinkWrap: true,
        itemCount: files.length,
        itemBuilder: (context, i) => _tile(context, palette, primary, files[i]),
      );
    }
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 220,
        mainAxisSpacing: DreamSpacing.xs,
        crossAxisSpacing: DreamSpacing.xs,
        childAspectRatio: 1.4,
      ),
      itemCount: files.length,
      itemBuilder: (context, i) => _card(context, palette, primary, files[i]),
    );
  }

  Widget _tile(
    BuildContext context,
    DreamPalette palette,
    Color primary,
    FileAttachment f,
  ) {
    final selected = allowSelect && controller.selectedIds.contains(f.id);
    return ListTile(
      dense: true,
      leading: Icon(
        Icons.insert_drive_file_outlined,
        color: selected ? primary : palette.textSecondary,
      ),
      title: Text(
        f.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: palette.textPrimary, fontSize: 13),
      ),
      subtitle: Text(
        _sizeLabel(f.bytes),
        style: TextStyle(color: palette.textTertiary, fontSize: 12),
      ),
      trailing: allowSelect
          ? Icon(
              selected ? Icons.check_circle : Icons.radio_button_unchecked,
              color: selected ? primary : palette.textTertiary,
            )
          : IconButton(
              icon: Icon(Icons.delete_outline, color: palette.textTertiary),
              onPressed: () => controller.remove(f.id),
            ),
      onTap: allowSelect ? () => controller.toggleSelected(f.id) : null,
    );
  }

  Widget _card(
    BuildContext context,
    DreamPalette palette,
    Color primary,
    FileAttachment f,
  ) {
    final selected = allowSelect && controller.selectedIds.contains(f.id);
    return InkWell(
      borderRadius: BorderRadius.circular(DreamRadius.md),
      onTap: allowSelect ? () => controller.toggleSelected(f.id) : null,
      child: Container(
        padding: const EdgeInsets.all(DreamSpacing.sm),
        decoration: BoxDecoration(
          color: selected ? palette.brandSoft : palette.composer,
          borderRadius: BorderRadius.circular(DreamRadius.md),
          border: Border.all(color: selected ? primary : palette.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    f.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: palette.textPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                if (allowSelect)
                  Icon(
                    selected
                        ? Icons.check_circle
                        : Icons.radio_button_unchecked,
                    size: 18,
                    color: selected ? primary : palette.textTertiary,
                  )
                else
                  IconButton(
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    icon: Icon(
                      Icons.delete_outline,
                      size: 18,
                      color: palette.textTertiary,
                    ),
                    onPressed: () => controller.remove(f.id),
                  ),
              ],
            ),
            const Spacer(),
            Text(
              _sizeLabel(f.bytes),
              style: TextStyle(color: palette.textTertiary, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pick(BuildContext context) async {
    try {
      await controller.pickAndUpload();
    } on AttachException catch (e) {
      if (!context.mounted) return;
      _snack(context, e.message);
    } catch (_) {
      if (!context.mounted) return;
      _snack(context, '上传失败，请重试。');
    }
  }

  void _snack(BuildContext context, String msg) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg)));
  }

  static String _sizeLabel(int bytes) {
    if (bytes >= 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MiB';
    }
    if (bytes >= 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KiB';
    }
    return '$bytes B';
  }
}
