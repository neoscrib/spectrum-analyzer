export type Mode = "oqpsk" | "qpsk";
export interface ReplayOptions {
  startSeconds: number;
  durationSeconds: number | null;
  frequencyOffsetHz: number;
  historicalDoppler?: boolean;
  autoBias?: boolean;
  estimateBias?: boolean;
  recordingStartUtc?: string;
  reacquireSeconds?: number;
  carrierLimitHz?: number;
}
export interface Settings {
  satellite: number;
  frequency: number;
  center: number;
  sampleRate: number;
  symbolRate: number;
  mode: Mode;
  nrzm: boolean;
  interleaved: boolean;
  gain: number;
  ppm: number;
  doppler: boolean;
  frequencyBiasHz?: number;
  carrierLimitHz?: number;
  latitude: number;
  longitude: number;
  altitude: number;
  minElevation: number;
  tle: string;
  replayFormat: "cu8" | "cs16" | "cf32";
}
export interface ChannelImage {
  apid: number;
  width: number;
  height: number;
  startRow: number;
  pixels: Uint8Array;
}
