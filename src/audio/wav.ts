/**
 * Minimal WAV-kodare: 16-bit PCM mono. WAV valdes framför MP3/AAC eftersom
 * PCM loopar helt utan kodar-padding – avgörande för gapless loop i
 * <audio loop>-element.
 */
export function encodeWav16Mono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataSize = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true); // fmt-chunkens storlek
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bitar per sample
  writeStr(36, "data");
  v.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    v.setInt16(off, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
    off += 2;
  }
  return buf;
}

export function wavBlob(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWav16Mono(samples, sampleRate)], { type: "audio/wav" });
}
