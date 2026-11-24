import 'package:material_ui/material_ui.dart';

import '../../design/tokens.dart';

/// Dream 的极简字标：圆角渐变底 + 一笔白色轨迹。
class DreamMark extends StatelessWidget {
  const DreamMark({super.key, this.size = 30});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.3),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF82A4FF), Color(0xFF3F63F5)],
        ),
        boxShadow: [
          BoxShadow(
            color: DreamColors.brand.withValues(alpha: 0.3),
            blurRadius: size * 0.6,
            offset: Offset(0, size * 0.18),
          ),
        ],
      ),
      child: CustomPaint(painter: _MarkPainter()),
    );
  }
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final stroke = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 0.085
      ..strokeCap = StrokeCap.round;
    final path = Path()
      ..moveTo(size.width * 0.26, size.height * 0.68)
      ..cubicTo(
        size.width * 0.74,
        size.height * 0.74,
        size.width * 0.82,
        size.height * 0.22,
        size.width * 0.40,
        size.height * 0.30,
      );
    canvas.drawPath(path, stroke);
    canvas.drawCircle(
      Offset(size.width * 0.34, size.height * 0.48),
      size.width * 0.06,
      Paint()..color = Colors.white,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
