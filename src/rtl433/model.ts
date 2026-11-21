export interface Rtl433Options {
  mode: "default" | "all" | "single";
  protocol: number;
  level: number | null;
}
export const rtl433Defaults: Rtl433Options = {
  mode: "default",
  protocol: 19,
  level: null,
};
export function validateRtl433(o: Rtl433Options) {
  if (
    !o ||
    !["default", "all", "single"].includes(o.mode) ||
    !Number.isInteger(o.protocol) ||
    o.protocol < 1 ||
    o.protocol > 1000
  )
    throw Error("Choose a valid rtl_433 protocol selection.");
  if (
    o.level !== null &&
    (!Number.isFinite(o.level) || o.level < -60 || o.level > -1)
  )
    throw Error("rtl_433 threshold must be Auto or −60 to −1 dBFS.");
}
export interface Rtl433Protocol {
  id: number;
  name: string;
  disabled: number;
}
export interface Rtl433Status {
  enabled: number;
  ook: number;
  fsk: number;
  messages: number;
  truncated: number;
  dropped: number;
  protocols?: Rtl433Protocol[];
}
export interface Rtl433Message {
  id: number;
  receivedAt: string;
  source: "live" | "test";
  frequency: number;
  bandwidth: number;
  data: Record<string, unknown>;
}
