import type { Settings } from "../model";
export type SourceKind = "rtl" | "hackrf" | "soapy";
export interface SourceOptions {
  kind: SourceKind;
  url: string;
  args: string;
  token?: string;
}
export interface ReceiverInfo {
  name: string;
  transport: "WebUSB" | "WebSocket";
  minHz: number;
  maxHz: number;
  frequencyRanges?: [number, number][];
  gain: { min: number; max: number; step: number; auto: boolean };
  ppm: boolean;
  nativeRate: number;
  nativeFormat: string;
  sampleRate: number;
  format: "cu8";
  generated?: boolean;
}
export interface ReceiverSettings {
  center: number;
  gain: number | null;
  ppm: number;
}
/** Sources deliver continuous, ordered CU8 at the decoder rate. Native format
 * and rate remain explicit; conversion happens inside each source adapter. */
export interface RadioSource {
  info: ReceiverInfo;
  configure(settings: ReceiverSettings): Promise<void>;
  readSamples(count: number): Promise<{ data: ArrayBuffer }>;
  close(): Promise<void>;
}
export const defaultSource: SourceOptions = {
  kind: "rtl",
  url: "ws://127.0.0.1:8092",
  args: "",
};
export function readSourceOptions(): SourceOptions {
  try {
    const saved = JSON.parse(localStorage.getItem("spectrum-source") ?? "{}");
    return {
      kind: ["rtl", "hackrf", "soapy"].includes(saved.kind)
        ? saved.kind
        : "rtl",
      url: typeof saved.url === "string" ? saved.url : defaultSource.url,
      args: typeof saved.args === "string" ? saved.args : "",
    };
  } catch {
    return { ...defaultSource };
  }
}
export function sourceDefaults(kind: SourceKind): ReceiverInfo {
  return {
    name:
      kind === "rtl"
        ? "RTL-SDR"
        : kind === "hackrf"
          ? "HackRF One"
          : "SoapySDR receiver",
    transport: kind === "soapy" ? "WebSocket" : "WebUSB",
    minHz: kind === "rtl" ? 24e6 : kind === "hackrf" ? 1e6 : 1,
    maxHz: kind === "rtl" ? 1766e6 : 6e9,
    gain:
      kind === "rtl"
        ? { min: 0, max: 49.6, step: 0.1, auto: true }
        : { min: 0, max: 102, step: 2, auto: kind === "soapy" },
    ppm: kind !== "hackrf",
    nativeRate: 2400000,
    nativeFormat: kind === "hackrf" ? "cs8" : kind === "rtl" ? "cu8" : "cf32",
    sampleRate: 2400000,
    format: "cu8",
  };
}
export function validateReceiver(s: ReceiverSettings, info: ReceiverInfo) {
  const ranges = info.frequencyRanges ?? [[info.minHz, info.maxHz]];
  if (!ranges.some(([min, max]) => s.center >= min && s.center <= max))
    throw Error(`Frequency is outside ${info.name}'s tuning range.`);
  if (
    s.gain === null
      ? !info.gain.auto
      : !Number.isFinite(s.gain) ||
        s.gain < info.gain.min ||
        s.gain > info.gain.max
  )
    throw Error(
      `Choose a supported gain for ${info.name} (${info.gain.min}–${info.gain.max} dB${info.gain.auto ? " or auto" : ""}).`,
    );
  if (!info.ppm && s.ppm !== 0)
    throw Error(`${info.name} does not offer PPM correction; set it to zero.`);
}
export function validateSourceDecoder(s: Settings, info: ReceiverInfo) {
  validateReceiver(s, info);
  // Resampling does not create capture bandwidth. Restrict the selected channel
  // to the native sampled band even when it is upsampled for a fixed-rate decoder.
  const available = Math.min(info.nativeRate, info.sampleRate);
  if (
    s.decoder !== "none" &&
    Math.abs(s.channel - s.center) + s.bandwidth / 2 > available / 2
  )
    throw Error(
      `Keep the decoder channel inside ${info.name}'s ${(available / 1e6).toFixed(3)} MHz capture.`,
    );
  if ((s.decoder === "armer" || s.decoder === "adsb") && available < 2400000)
    throw Error(
      `${s.decoder.toUpperCase()} currently requires a source with at least 2.4 MSPS.`,
    );
}
