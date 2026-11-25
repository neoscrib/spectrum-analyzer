import { SAMPLE_RATE, type Settings } from "../model";
import type { ReceiverInfo } from "../sources/model";
export const BYTE_RATE = SAMPLE_RATE * 2;
export const MEMORY_LIMIT = 64 * 1024 * 1024;
export const QUEUE_LIMIT = 16 * 1024 * 1024;
export interface CaptureInfo {
  filename: string;
  source: "live" | "test";
  settings: Settings;
  startedAt: string;
  receiver?: ReceiverInfo;
}
export interface RecordingState {
  phase: "idle" | "recording" | "saving" | "complete" | "error";
  mode?: "disk" | "download";
  info?: CaptureInfo;
  bytes: number;
  written: number;
  queued: number;
  reason: string;
  dataSaved: boolean;
  metadataSaved: boolean;
  metadata?: string;
  blob?: Blob;
}
export const idleRecording: RecordingState = {
  phase: "idle",
  bytes: 0,
  written: 0,
  queued: 0,
  reason: "",
  dataSaved: false,
  metadataSaved: false,
};
export function captureName(
  settings: Settings,
  source: "live" | "test",
  date = new Date(),
): string {
  return `spectrum-${source === "test" ? "GENERATED-" : ""}${(settings.center / 1e6).toFixed(6)}M-2400k-${date.toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.cu8`;
}
export function metadataName(filename: string): string {
  return filename.replace(/\.cu8$/i, "") + ".sigmf-meta";
}
/** Core-only SigMF 1.2.6, referencing the raw .cu8 non-conforming dataset by
 * name. Time is host receipt time, not a calibrated hardware timestamp. */
export function captureMetadata(
  info: CaptureInfo,
  bytes: number,
  reason: string,
): string {
  const s = info.settings,
    samples = bytes / 2;
  return (
    JSON.stringify(
      {
        global: {
          "core:datatype": "cu8",
          ...(s.decoder === "meteor" || info.receiver
            ? {
                "core:extensions": [
                  { name: "spectrum", version: "1.0.0", optional: true },
                ],
                ...(s.decoder === "meteor"
                  ? { "spectrum:meteor": { ...s.meteor, frequency: s.channel } }
                  : {}),
                ...(info.receiver
                  ? { "spectrum:receiver": info.receiver }
                  : {}),
              }
            : {}),
          "core:sample_rate": SAMPLE_RATE,
          "core:version": "1.2.6",
          "core:dataset": info.filename,
          "core:recorder": "Spectrum browser SDR",
          "core:description": [
            info.source === "test" || info.receiver?.generated
              ? `GENERATED ${s.decoder.toUpperCase()} IQ; not received RF.`
              : info.receiver
                ? `Live ${info.receiver.name} ${info.receiver.transport} IQ; native ${info.receiver.nativeFormat} at ${info.receiver.nativeRate} samples/s.`
                : "Live RTL-SDR WebUSB IQ.",
            `${info.receiver?.transport === "WebSocket" ? "Bridge output after streaming sample-rate conversion when needed and 8-bit quantization" : "Full capture before decoder channel filtering"}; I then Q, unsigned 8-bit, zero near 127.5. ${bytes} bytes; ${samples} complex samples; ${(bytes / BYTE_RATE).toFixed(6)} seconds.`,
            `Requested tuner gain: ${s.gain === null ? "auto" : s.gain + " dB"}; PPM correction: ${s.ppm}. ${info.receiver?.transport === "WebSocket" ? "Antenna power follows the native driver's settings; not controlled by the bridge." : "Bias tee off."}`,
            `Selected decoder: ${s.decoder}; channel: ${s.channel} Hz; decoder bandwidth: ${s.bandwidth} Hz (not applied to recorded IQ).`,
            `Capture ended: ${reason}. Timestamp is approximate host receipt time of the first recorded block, not a hardware clock. Sample continuity is not hardware timestamp-verified.`,
          ].join(" "),
          ...(info.source === "live"
            ? {
                "core:hw": info.receiver
                  ? `${info.receiver.name} (${info.receiver.transport})`
                  : "RTL-SDR (WebUSB)",
              }
            : {}),
        },
        captures: samples
          ? [
              {
                "core:sample_start": 0,
                "core:frequency": s.center,
                "core:datetime": info.startedAt,
              },
            ]
          : [],
        annotations: samples
          ? [
              {
                "core:sample_start": 0,
                "core:sample_count": samples,
                "core:label":
                  info.source === "test" || info.receiver?.generated
                    ? "GENERATED test IQ"
                    : "Live RF capture",
              },
            ]
          : [],
      },
      null,
      2,
    ) + "\n"
  );
}
export interface RecordingSink {
  mode: "disk" | "download";
  filename: string;
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<Blob | undefined>;
  abort: () => Promise<void>;
  saveMetadata: (text: string) => Promise<void>;
}
