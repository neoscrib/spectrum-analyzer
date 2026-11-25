import type { MeteorBiasStatus } from "./bias";
import {
  DEFAULT_SETTINGS,
  validateSettings as validateReference,
} from "./settings";
import type { Settings as ReferenceSettings, ReplayOptions } from "./types";
import type { Settings } from "../model";
export type MeteorOptions = Pick<
  ReferenceSettings,
  | "satellite"
  | "symbolRate"
  | "mode"
  | "nrzm"
  | "interleaved"
  | "doppler"
  | "frequencyBiasHz"
  | "carrierLimitHz"
  | "latitude"
  | "longitude"
  | "altitude"
  | "minElevation"
  | "tle"
> & {
  reacquireSeconds: number;
  autoBias?: boolean;
  autoBiasDefaultVersion?: 1;
};
export type IqFormat = "cu8" | "cs16" | "cf32";
export interface DecoderInput {
  referenceTime?: string;
  sampleRate: number;
  format: IqFormat;
  replay?: ReplayOptions;
}
export const liveInput: DecoderInput = { sampleRate: 2400000, format: "cu8" };
export const meteorDefaults: MeteorOptions = {
  satellite: DEFAULT_SETTINGS.satellite,
  symbolRate: 72000,
  mode: "oqpsk",
  nrzm: true,
  interleaved: false,
  doppler: false,
  frequencyBiasHz: 0,
  latitude: DEFAULT_SETTINGS.latitude,
  longitude: DEFAULT_SETTINGS.longitude,
  altitude: DEFAULT_SETTINGS.altitude,
  minElevation: 10,
  tle: "",
  reacquireSeconds: 3,
  autoBias: true,
  autoBiasDefaultVersion: 1,
};
export function referenceSettings(
  s: Settings,
  input: DecoderInput = liveInput,
): ReferenceSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...s.meteor,
    frequency: s.channel,
    center: s.center,
    sampleRate: input.sampleRate,
    replayFormat: input.format,
    gain: s.gain ?? 0,
    ppm: s.ppm,
  };
}
export function validateMeteor(options: MeteorOptions): void {
  if (options.autoBias !== undefined && typeof options.autoBias !== "boolean")
    throw Error("Choose whether Meteor bias correction is automatic.");
  const problem = validateReference({ ...DEFAULT_SETTINGS, ...options });
  if (problem) throw Error(problem);
  if (
    !Number.isFinite(options.reacquireSeconds) ||
    options.reacquireSeconds < 0 ||
    options.reacquireSeconds > 60
  )
    throw Error("Meteor reacquisition timeout must be 0–60 seconds.");
}
export interface MeteorStatus {
  bias?: MeteorBiasStatus;
  samples: number;
  sampleRate: number;
  frames: number;
  badFrames: number;
  packets: number;
  strips: number;
  jpegErrors: number;
  rs: number;
  corrected: number;
  viterbi: number;
  pll: boolean;
  carrier: number;
  offsetHz: number;
  dopplerHz: number;
  lastFrameSample: number | null;
  reacquisitions: number;
  decodeMs: number;
  bufferedSoftBits: number;
  memoryBytes: number;
  captureTimeUtc?: string;
}
export type { ChannelImage } from "./types";
