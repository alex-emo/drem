import 'dart:typed_data';

/// 将 raw PCM（16kHz 单声道 16-bit 小端）组装成带 WAV 头（RIFF/WAVE/PCM）的字节。
///
/// 头固定 44 字节：`RIFF` + chunkSize + `WAVE` + `fmt `(16) + PCM(1) +
/// 声道数 + 采样率 + 字节率 + 块对齐 + 位深 + `data` + 数据长度，后接 PCM 数据。
Uint8List pcmToWav(
  Uint8List pcm, {
  int sampleRate = 16000,
  int numChannels = 1,
  int bitsPerSample = 16,
}) {
  final bytesPerSample = bitsPerSample ~/ 8;
  final byteRate = sampleRate * numChannels * bytesPerSample;
  final blockAlign = numChannels * bytesPerSample;
  final dataSize = pcm.length;

  final header = ByteData(44);
  void ascii(int offset, String s) {
    for (var i = 0; i < s.length; i++) {
      header.setUint8(offset + i, s.codeUnitAt(i));
    }
  }

  ascii(0, 'RIFF');
  header.setUint32(4, 36 + dataSize, Endian.little);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, Endian.little); // fmt 块长度（PCM）
  header.setUint16(20, 1, Endian.little); // audioFormat = PCM
  header.setUint16(22, numChannels, Endian.little);
  header.setUint32(24, sampleRate, Endian.little);
  header.setUint32(28, byteRate, Endian.little);
  header.setUint16(32, blockAlign, Endian.little);
  header.setUint16(34, bitsPerSample, Endian.little);
  ascii(36, 'data');
  header.setUint32(40, dataSize, Endian.little);

  final result = Uint8List(44 + dataSize);
  result.setRange(0, 44, header.buffer.asUint8List());
  result.setRange(44, result.length, pcm);
  return result;
}
