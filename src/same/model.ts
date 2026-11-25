export interface SameOptions {
  enabled: boolean;
  attention: boolean;
}
export const sameDefaults: SameOptions = { enabled: false, attention: true };
export type SameNativeEvent =
  | { kind: "burst"; raw: string; bytes: number[]; seconds: number }
  | {
      kind: "message";
      raw: string;
      voted: number;
      errors: number;
      seconds: number;
    }
  | { kind: "rejected"; reason: string; seconds: number }
  | {
      kind: "tone";
      tone: "noaa1050" | "easDual";
      edge: "start" | "end";
      start: number;
      end: number | null;
      seconds: number;
    };
export interface SameDiagnostics {
  samples: number;
  bursts: number;
  messages: number;
  recovered: number;
  rejected: number;
  syncLosses: number;
  dropped: number;
  timedOut: number;
  link: string;
  afsk: string;
  lastSuccess: number | null;
}
export interface SameBatch {
  source?: "live" | "test" | "replay" | "file" | "generated";
  referenceTime?: string;
  stream: string;
  frequency: number | null;
  sampleRate: number;
  sourceSeconds: number;
  processingMs: number;
  events: SameNativeEvent[];
  diagnostics?: SameDiagnostics;
}
export interface SameLocation {
  code: string;
  subdivision: string;
  stateCode: string;
  countyCode: string;
  state: string;
  county: string;
  name: string;
  known: boolean;
}
export type SameCategory =
  | "warning"
  | "watch"
  | "emergency"
  | "statement"
  | "test"
  | "information"
  | "unknown";
export interface SameHeader {
  raw: string;
  originator: string;
  originatorName: string;
  event: string;
  eventName: string;
  category: SameCategory;
  locations: SameLocation[];
  durationMinutes: number;
  day: number;
  hour: number;
  minute: number;
  issued: string;
  expires: string;
  inferredYear: number;
  sender: string;
}
export interface SameRecord {
  source?: SameBatch["source"];
  id: number;
  stream: string;
  frequency: number | null;
  kind: "alert" | "candidate" | "eom" | "tone" | "rejected";
  verification: "single" | "agreed" | "recovered" | "unverified";
  header?: SameHeader;
  raw: string[];
  observations: number;
  retransmissions: number;
  received: string;
  lastReceived: string;
  seconds: number;
  lastSeconds: number;
  ended?: string;
  reason?: string;
  voted?: number;
  errors?: number;
  tone?: "noaa1050" | "easDual";
  duration?: number;
  active?: boolean;
}
