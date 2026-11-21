export type OokEncoding = "raw" | "pwm" | "ppm" | "nrz";
export interface OokOptions {
  threshold: number | null;
  minPulseUs: number;
  gapUs: number;
  encoding: OokEncoding;
  shortUs: number;
  longUs: number;
  invert: boolean;
}
export const ookDefaults: OokOptions = {
  threshold: null,
  minPulseUs: 50,
  gapUs: 5000,
  encoding: "raw",
  shortUs: 500,
  longUs: 1000,
  invert: false,
};
export function validateOok(o: OokOptions): void {
  if (
    !o ||
    (o.threshold !== null &&
      (!Number.isFinite(o.threshold) || o.threshold < -90 || o.threshold > -5))
  )
    throw Error("Choose an automatic OOK threshold or −90 to −5 dBFS.");
  if (
    !Number.isFinite(o.minPulseUs) ||
    o.minPulseUs < 25 ||
    o.minPulseUs > 5000
  )
    throw Error("Minimum OOK pulse must be between 25 and 5000 µs.");
  if (
    !Number.isFinite(o.gapUs) ||
    o.gapUs < 1000 ||
    o.gapUs > 100000 ||
    o.gapUs <= o.minPulseUs * 2
  )
    throw Error(
      "Burst gap must be 1000–100000 µs and more than twice the minimum pulse.",
    );
  if (
    !["raw", "pwm", "ppm", "nrz"].includes(o.encoding) ||
    typeof o.invert !== "boolean"
  )
    throw Error("Choose a supported OOK bit interpretation.");
  if (
    ![o.shortUs, o.longUs].every(
      (v) => Number.isFinite(v) && v >= 25 && v <= 10000,
    ) ||
    (o.encoding !== "nrz" && o.longUs <= o.shortUs)
  )
    throw Error(
      "OOK timings must be 25–10000 µs, with long greater than short.",
    );
}
export interface OokBurst {
  startSeconds: number;
  endSeconds: number;
  durations: number[];
  gapLowerBound: boolean;
}
export interface OokStatus {
  seconds: number;
  level: number;
  noise: number;
  peak: number;
  threshold: number;
  high: boolean;
  bursts: number;
  rejected: number;
  sampleRate: number;
  traceRate: number;
  trace: number[];
}
export interface OokCapture extends OokBurst {
  id: number;
  frequency: number;
  bandwidth: number;
  test: boolean;
  receivedAt: string;
  options: OokOptions;
}
/** Explicitly configured interpretation, not device recognition. '?' retains
 * timing failures rather than manufacturing plausible-looking data. */
export function interpretBurst(
  burst: OokBurst,
  options: OokOptions,
): string | null {
  if (options.encoding === "raw") return null;
  const classify = (us: number) => {
    const ds = Math.abs(us - options.shortUs) / options.shortUs,
      dl = Math.abs(us - options.longUs) / options.longUs;
    return Math.min(ds, dl) > 0.25 ? "?" : ds <= dl ? "0" : "1";
  };
  let bits = "";
  if (options.encoding === "pwm" || options.encoding === "ppm") {
    const start = options.encoding === "pwm" ? 0 : 1;
    // Trailing idle is a burst delimiter, never a PPM data bit.
    const end = burst.durations.length - (start === 1 ? 1 : 0);
    for (let i = start; i < end; i += 2) bits += classify(burst.durations[i]);
  } else {
    for (let i = 0; i < burst.durations.length - 1; i++) {
      const cells = Math.round(burst.durations[i] / options.shortUs);
      if (
        cells < 1 ||
        cells > 256 ||
        Math.abs(burst.durations[i] / options.shortUs - cells) > 0.25
      )
        bits += "?";
      else bits += (i % 2 === 0 ? "1" : "0").repeat(cells);
      if (bits.length > 8192) return bits.slice(0, 8192) + "…";
    }
  }
  return options.invert
    ? bits.replace(/[01]/g, (b) => (b === "0" ? "1" : "0"))
    : bits;
}
export function burstHex(bits: string | null): string | null {
  if (!bits || /[^01]/.test(bits) || bits.length % 8) return null;
  return bits
    .match(/.{8}/g)!
    .map((b) => parseInt(b, 2).toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}
/** rtl_433's documented pulse/gap text format. Last idle is a lower bound. */
export function ookText(c: OokCapture): string {
  const rows = [
    ";pulse data",
    ";version 1",
    ";timescale 1us",
    `;ook ${c.durations.length / 2} pulses`,
    `;freq1 ${c.frequency}`,
    `; Generated test: ${c.test ? "yes" : "no"}`,
    `; Received ${c.receivedAt}`,
    "; Final gap is an observed lower bound; no device protocol/checksum verified.",
  ];
  for (let i = 0; i < c.durations.length; i += 2)
    rows.push(
      `${Math.round(c.durations[i])} ${Math.round(c.durations[i + 1] ?? 0)}`,
    );
  rows.push(";end");
  return rows.join("\n") + "\n";
}
