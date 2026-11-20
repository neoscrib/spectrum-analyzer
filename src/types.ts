import type { Settings } from "./model";
import type { ArmerPolicy, ArmerStatus, P25Event } from "./armer/model";
export interface WwvTimecode {
  year: number;
  dayOfYear: number;
  hour: number;
  minute: number;
  dut1: number;
  leapWarning: boolean;
  dst1: boolean;
  dst2: boolean;
  confirmed: boolean;
  consecutiveFrames: number;
}
export interface WwvStatus {
  samples: number;
  second: number | null;
  synchronized: boolean;
  confirmed: boolean;
  pulseMs: number;
  symbol: number;
  symbols: number[];
  subcarrier: number;
  validFrames: number;
  rejectedFrames: number;
  frame: WwvTimecode | null;
  lastFrameSample: number | null;
  error: string | null;
}
/** Audio buffers are interleaved L/R at 48 kHz. Worker transfers ownership to
 * the main thread, which transfers audio onward to its AudioWorklet exactly once.
 * firstSample is the CU8 source sample index within the current revision. */
export type DecoderEvent =
  | { type: "telemetry"; protocol: "armer"; status: ArmerStatus }
  | { type: "message"; protocol: "armer"; event: P25Event }
  | {
      type: "audio";
      samples: Float32Array;
      sampleRate: 48000;
      channels: 2;
      firstSample: number;
    }
  | { type: "telemetry"; protocol: "wfm"; stereo: boolean; pilotLevel: number }
  | { type: "timecode"; protocol: "wwv"; status: WwvStatus }
  | {
      type: "sync";
      protocol: "wwv";
      locked: boolean;
      state: "searching" | "minute" | "confirmed";
    };
export type WorkerIn =
  | {
      type: "init";
      settings: Settings;
      revision: number;
      armerPolicy?: ArmerPolicy;
    }
  | { type: "armer-policy"; policy: ArmerPolicy; revision: number }
  | { type: "configure"; settings: Settings; revision: number }
  | { type: "iq"; data: ArrayBuffer; revision: number }
  | { type: "test"; revision: number }
  | { type: "close" };
export type WorkerOut =
  | { type: "ready" }
  | { type: "error"; message: string }
  | {
      type: "processed";
      spectrum?: Float32Array;
      events: DecoderEvent[];
      rms: number;
      clipping: number;
      elapsed: number;
      samples: number;
      revision: number;
    };
export type Frame = Extract<WorkerOut, { type: "processed" }>;
