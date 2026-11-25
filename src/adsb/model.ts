export interface ReceiverLocation {
  lat: number;
  lon: number;
}
export interface AdsbOptions {
  correction: boolean;
  receiver: ReceiverLocation | null;
  localCpr: boolean;
  rangeNm: number;
}
export const adsbDefaults: AdsbOptions = {
  correction: false,
  receiver: null,
  localCpr: false,
  rangeNm: 180,
};
export function validateAdsb(o: AdsbOptions) {
  if (
    !o ||
    typeof o.correction !== "boolean" ||
    typeof o.localCpr !== "boolean" ||
    !Number.isFinite(o.rangeNm) ||
    o.rangeNm < 1 ||
    o.rangeNm > 300
  )
    throw Error(
      "Choose valid ADS-B correction and receiver range settings (1–300 NM).",
    );
  if (
    o.receiver &&
    (!Number.isFinite(o.receiver.lat) ||
      Math.abs(o.receiver.lat) > 85 ||
      !Number.isFinite(o.receiver.lon) ||
      Math.abs(o.receiver.lon) > 180)
  )
    throw Error(
      "Receiver coordinates must be within ±85° latitude and ±180° longitude.",
    );
}
export interface Cpr {
  lat: number;
  lon: number;
  odd: boolean;
  surface: boolean;
  type: number;
}
export interface ModeSFrame {
  hex: string;
  original: string;
  df: number;
  address: string;
  icao: boolean;
  addressType: number;
  source: number;
  corrected: number;
  syndrome: number;
  seconds: number;
  signal: number;
  capability: number;
  control: number;
  typeCode: number;
  subtype: number;
  airground: number;
  callsign?: string;
  baroAltitude?: number;
  gnssAltitude?: number;
  groundSpeed?: number;
  surfaceSpeedV2?: number;
  ias?: number;
  tas?: number;
  heading?: number;
  headingType?: number;
  baroRate?: number;
  gnssRate?: number;
  squawk?: string;
  emergency?: number;
  category?: number;
  version?: number;
  ident?: boolean;
  nacp?: number;
  selectedAltitude?: number;
  qnh?: number;
  cpr?: Cpr;
}
export interface Fresh<T> {
  value: T;
  at: number;
}
export interface Position extends ReceiverLocation {
  at: number;
  method: "global" | "local-aircraft" | "local-receiver" | "surface-pair";
  surface: boolean;
}
export interface Aircraft {
  id: string;
  address: string;
  icao: boolean;
  addressType: number;
  source: number;
  firstSeen: number;
  lastSeen: number;
  messages: number;
  corrected: number;
  signal: number;
  fields: Partial<{ [K in keyof ModeSFrame]: Fresh<ModeSFrame[K]> }>;
  position?: Position;
  trail: Position[];
  recent: ModeSFrame[];
  positionRejected: number;
}
export interface AdsbDiagnostics {
  samples: number;
  valid: number;
  corrected: number;
  preambles: number;
  rejected: number;
  unknownAddress: number;
  dropped: number;
  discontinuities: number;
  noise: number;
  processingMs: number;
  rate: number;
  active: number;
  positioned: number;
  positionRejected: number;
  evicted: number;
}
export interface AdsbBatch {
  seconds: number;
  aircraft: Aircraft[];
  stats: AdsbDiagnostics;
  source: "live" | "test" | "replay";
  referenceTime?: string;
}
export const FIELD_TTL: Partial<Record<keyof ModeSFrame, number>> = {
  callsign: 300,
  category: 300,
  version: 300,
  squawk: 60,
  emergency: 30,
  baroAltitude: 15,
  gnssAltitude: 15,
  groundSpeed: 15,
  heading: 15,
  headingType: 15,
  baroRate: 15,
  gnssRate: 15,
  ias: 15,
  tas: 15,
};
export function field<K extends keyof ModeSFrame>(
  a: Aircraft,
  key: K,
  now: number,
): ModeSFrame[K] | undefined {
  const f = a.fields[key];
  return f && now - f.at <= (FIELD_TTL[key] ?? 30) ? f.value : undefined;
}
export function distanceBearing(a: ReceiverLocation, b: ReceiverLocation) {
  const r = Math.PI / 180,
    p = a.lat * r,
    q = b.lat * r,
    d = (b.lon - a.lon) * r;
  const h =
    Math.sin((q - p) / 2) ** 2 +
    Math.cos(p) * Math.cos(q) * Math.sin(d / 2) ** 2;
  return {
    distance: 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, h))),
    bearing:
      (Math.atan2(
        Math.sin(d) * Math.cos(q),
        Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d),
      ) /
        r +
        360) %
      360,
  };
}
