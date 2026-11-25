/** Chunked PCM WAV reader: bounded file slices, no whole-recording allocation. */
export interface AudioWav {
  rate: number;
  channels: number;
  bits: number;
  floating: boolean;
  offset: number;
  length: number;
  stride: number;
}
export async function inspectAudioWav(file: Blob): Promise<AudioWav> {
  const head = new DataView(await file.slice(0, 12).arrayBuffer());
  const tag = (v: DataView, n: number) =>
    String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + n, 4));
  if (
    head.byteLength !== 12 ||
    tag(head, 0) !== "RIFF" ||
    tag(head, 8) !== "WAVE"
  )
    throw Error("Choose a PCM or float WAV audio file.");
  let format: Omit<AudioWav, "offset" | "length"> | undefined;
  for (let pos = 12; pos + 8 <= file.size;) {
    const h = new DataView(await file.slice(pos, pos + 8).arrayBuffer());
    const name = tag(h, 0),
      length = h.getUint32(4, true);
    if (pos + 8 + length > file.size) throw Error("Truncated WAV chunk.");
    if (name === "fmt ") {
      if (length < 16) throw Error("Invalid WAV format.");
      const f = new DataView(await file.slice(pos + 8, pos + 24).arrayBuffer());
      const code = f.getUint16(0, true),
        channels = f.getUint16(2, true),
        rate = f.getUint32(4, true),
        bits = f.getUint16(14, true),
        stride = f.getUint16(12, true);
      if (
        ![1, 2].includes(channels) ||
        rate < 8000 ||
        rate > 96000 ||
        !(
          (code === 1 && [8, 16, 24, 32].includes(bits)) ||
          (code === 3 && bits === 32)
        ) ||
        stride !== (channels * bits) / 8
      )
        throw Error(
          "Supported audio: mono/stereo PCM8/16/24/32 or float32 WAV, 8–96 kHz.",
        );
      format = { rate, channels, bits, floating: code === 3, stride };
    }
    if (name === "data") {
      if (!format || !length || length % format.stride)
        throw Error("Missing WAV format or incomplete audio frame.");
      return { ...format, offset: pos + 8, length };
    }
    pos += 8 + length + (length % 2);
  }
  throw Error("WAV has no audio data.");
}
export function monoAudio(buffer: ArrayBuffer, f: AudioWav): Float32Array {
  const view = new DataView(buffer),
    out = new Float32Array(buffer.byteLength / f.stride);
  for (let n = 0; n < out.length; n++) {
    let sum = 0;
    for (let c = 0; c < f.channels; c++) {
      const p = n * f.stride + (c * f.bits) / 8;
      const x = f.floating
        ? view.getFloat32(p, true)
        : f.bits === 8
          ? (view.getUint8(p) - 128) / 128
          : f.bits === 16
            ? view.getInt16(p, true) / 32768
            : f.bits === 24
              ? (view.getUint8(p) |
                  (view.getUint8(p + 1) << 8) |
                  (view.getInt8(p + 2) << 16)) /
                8388608
              : view.getInt32(p, true) / 2147483648;
      if (!Number.isFinite(x)) throw Error("Non-finite samples in WAV audio.");
      sum += x;
    }
    out[n] = sum / f.channels;
  }
  return out;
}
