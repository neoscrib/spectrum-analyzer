import type { MeteorBiasCommand } from "./meteor/bias";
import type { SameBatch, SameOptions } from "./same/model";
import type { DecoderInput, MeteorStatus, ChannelImage } from "./meteor/model";
import type { Settings } from "./model";
import type { RdsStatus } from "./rds/model";
import type { Rtl433Status } from "./rtl433/model";
import type { OokBurst, OokStatus } from "./ook/model";
import type {
  ArmerPolicy,
  ArmerStatus,
  P25Event,
  ArmerAudioChunk,
} from "./armer/model";
import type {
  NfmMonitorConfig,
  NfmTelemetry,
  NfmActivity,
} from "./presets/model";
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
/** Owned one-sided FFT bins. Bin k is k * sampleRate / fftSize Hz. */
export interface MultiplexSpectrum {
  bins: Float32Array;
  sampleRate: number;
  fftSize: number;
  averages: number;
}
/** Audio buffers are interleaved L/R at 48 kHz. Worker transfers ownership to
 * the main thread, which transfers audio onward to its AudioWorklet exactly once.
 * firstSample is the CU8 source sample index within the current revision. */
export type DecoderEvent =
  | { type: "same"; batch: SameBatch }
  | { type: "reset"; protocol: "meteor" }
  | {
      type: "telemetry";
      protocol: "meteor";
      status: MeteorStatus;
      constellation: Float32Array;
    }
  | { type: "image"; protocol: "meteor"; image: ChannelImage }
  | { type: "spectrum"; protocol: "wfm"; multiplex: MultiplexSpectrum }
  | { type: "message"; protocol: "rtl433"; data: Record<string, unknown> }
  | { type: "telemetry"; protocol: "rtl433"; status: Rtl433Status }
  | { type: "telemetry"; protocol: "ook"; status: OokStatus }
  | { type: "message"; protocol: "ook"; burst: OokBurst }
  | { type: "telemetry"; protocol: "nfm"; status: NfmTelemetry }
  | { type: "activity"; protocol: "nfm"; event: NfmActivity }
  | { type: "selection"; protocol: "nfm"; id: string | null }
  | { type: "telemetry"; protocol: "armer"; status: ArmerStatus }
  | { type: "message"; protocol: "armer"; event: P25Event }
  | {
      type: "audio";
      samples: Float32Array;
      sampleRate: 48000;
      channels: 2;
      firstSample: number;
      armer?: ArmerAudioChunk;
    }
  | {
      type: "telemetry";
      protocol: "wfm";
      stereo: boolean;
      pilotLevel: number;
      rds?: RdsStatus;
    }
  | { type: "timecode"; protocol: "wwv"; status: WwvStatus }
  | {
      type: "sync";
      protocol: "wwv";
      locked: boolean;
      state: "searching" | "minute" | "confirmed";
    };
export type WorkerIn =
  | { type: "same-options"; options: SameOptions }
  | { type: "spectrum-visibility"; enabled: boolean }
  | { type: "meteor-bias"; command: MeteorBiasCommand }
  | { type: "wfm-multiplex"; enabled: boolean }
  | { type: "wfm-stereo"; enabled: boolean }
  | { type: "wfm-rds"; enabled: boolean }
  | { type: "recenter"; settings: Settings; revision: number }
  | {
      type: "init";
      settings: Settings;
      revision: number;
      armerPolicy?: ArmerPolicy;
      monitor?: NfmMonitorConfig | null;
      multiplex?: boolean;
      spectrum?: boolean;
      input?: DecoderInput;
    }
  | { type: "armer-policy"; policy: ArmerPolicy; revision: number }
  | {
      type: "configure";
      settings: Settings;
      revision: number;
      monitor?: NfmMonitorConfig | null;
    }
  | { type: "nfm-hold"; id: string | null; revision: number }
  | { type: "iq"; data: ArrayBuffer; revision: number }
  | { type: "test"; revision: number }
  | { type: "recording"; id: number }
  | { type: "close" };
export type WorkerOut =
  | { type: "ready" }
  | { type: "error"; message: string }
  | {
      type: "processed";
      /** Original CU8 input returned only while recording; ownership transfers
       * worker -> main -> recorder. Never detach or mutate it after enqueue. */
      recording?: { id: number; data: ArrayBuffer };
      spectrum?: Float32Array;
      events: DecoderEvent[];
      rms: number;
      clipping: number;
      elapsed: number;
      samples: number;
      sampleRate?: number;
      revision: number;
    };
export type Frame = Extract<WorkerOut, { type: "processed" }>;
