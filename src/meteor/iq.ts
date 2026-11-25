import type { Settings } from "./types";
export interface IqSource {
  referenceTime?: string;
  format: Settings["replayFormat"];
  sampleRate: number;
  offset: number;
  length: number;
  center?: number;
}
/** Parse chunked RIFF WAV headers without loading multi-GB captures into memory. */
export async function inspectIq(
  file: File,
  settings: Settings,
): Promise<IqSource> {
  const header = new DataView(await file.slice(0, 12).arrayBuffer());
  const tag = (d: DataView, p: number) =>
    String.fromCharCode(...new Uint8Array(d.buffer, d.byteOffset + p, 4));
  if (
    header.byteLength >= 12 &&
    tag(header, 0) === "RIFF" &&
    tag(header, 8) === "WAVE"
  ) {
    let pos = 12,
      format: Settings["replayFormat"] | undefined,
      rate = 0;
    while (pos + 8 <= file.size) {
      const h = new DataView(await file.slice(pos, pos + 8).arrayBuffer()),
        name = tag(h, 0),
        len = h.getUint32(4, true);
      if (pos + 8 + len > file.size) throw Error("Truncated WAV chunk.");
      if (name === "fmt ") {
        if (len < 16) throw Error("Invalid WAV format chunk.");
        const fmt = new DataView(
            await file.slice(pos + 8, pos + 24).arrayBuffer(),
          ),
          code = fmt.getUint16(0, true),
          channels = fmt.getUint16(2, true),
          bits = fmt.getUint16(14, true);
        if (channels !== 2) throw Error("IQ WAV needs two channels: I then Q.");
        rate = fmt.getUint32(4, true);
        format =
          code === 1 && bits === 8
            ? "cu8"
            : code === 1 && bits === 16
              ? "cs16"
              : code === 3 && bits === 32
                ? "cf32"
                : undefined;
        if (!format)
          throw Error(
            "Supported IQ WAV formats: stereo PCM8, PCM16 or float32.",
          );
      }
      if (name === "data") {
        if (!format || rate < 180000 || rate > 2400000)
          throw Error("Missing or unsupported IQ WAV sample rate.");
        const stride = format === "cu8" ? 2 : format === "cs16" ? 4 : 8;
        if (len % stride) throw Error("Incomplete IQ pair in WAV data.");
        return { format, sampleRate: rate, offset: pos + 8, length: len };
      }
      pos += 8 + len + (len % 2);
    }
    throw Error("WAV contains no IQ data chunk.");
  }
  const stride =
    settings.replayFormat === "cu8"
      ? 2
      : settings.replayFormat === "cs16"
        ? 4
        : 8;
  if (file.size < 4096 || file.size % stride)
    throw Error("Raw IQ must contain complete interleaved I/Q pairs.");
  return {
    format: settings.replayFormat,
    sampleRate: settings.sampleRate,
    offset: 0,
    length: file.size,
  };
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
