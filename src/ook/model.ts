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
export interface OokInterval {
  index: number;
  high: boolean;
  startUs: number;
  endUs: number;
  durationUs: number;
  delimiter: boolean;
}
export interface OokBitSpan {
  /** Zero-based index; UI labels are one-based. */
  index: number;
  value: "0" | "1" | "?";
  startUs: number;
  endUs: number;
}
export interface OokInterpretation {
  bits: string | null;
  spans: OokBitSpan[];
  intervals: OokInterval[];
  durationUs: number;
  /** End of the signal, excluding an observed trailing idle delimiter. */
  signalEndUs: number;
  truncated: boolean;
}

/** Bit decisions and their source spans share one interpretation path. All
 * times are relative to the burst start and derive from stored capture edges. */
export function interpretBurstWithTiming(
  burst: OokBurst,
  options: OokOptions,
): OokInterpretation {
  let at = 0;
  const intervals = burst.durations.map((durationUs, index): OokInterval => {
    const startUs = at;
    at += durationUs;
    return {
      index,
      high: index % 2 === 0,
      startUs,
      endUs: at,
      durationUs,
      delimiter:
        index === burst.durations.length - 1 &&
        index % 2 === 1 &&
        burst.gapLowerBound,
    };
  });
  const last = intervals.at(-1);
  const spans: OokBitSpan[] = [];
  let truncated = false;
  const result = (): OokInterpretation => ({
    bits:
      options.encoding === "raw"
        ? null
        : spans.map((span) => span.value).join("") + (truncated ? "…" : ""),
    spans,
    intervals,
    durationUs: at,
    signalEndUs: last?.delimiter ? last.startUs : at,
    truncated,
  });
  if (options.encoding === "raw") return result();
  const classify = (us: number): OokBitSpan["value"] => {
    const ds = Math.abs(us - options.shortUs) / options.shortUs,
      dl = Math.abs(us - options.longUs) / options.longUs;
    return Math.min(ds, dl) > 0.25 ? "?" : ds <= dl ? "0" : "1";
  };
  const add = (value: OokBitSpan["value"], startUs: number, endUs: number) => {
    if (spans.length >= 8192) {
      truncated = true;
      return;
    }
    spans.push({
      index: spans.length,
      startUs,
      endUs,
      value:
        options.invert && value !== "?" ? (value === "0" ? "1" : "0") : value,
    });
  };
  if (options.encoding === "pwm" || options.encoding === "ppm") {
    for (let i = 0; i < intervals.length; i += 2) {
      const high = intervals[i],
        low = intervals[i + 1];
      if (options.encoding === "pwm") {
        // A PWM high is a complete decision even if its following gap was
        // omitted. Include its data gap, but never the burst idle delimiter.
        add(
          classify(high.durationUs),
          high.startUs,
          low && !low.delimiter ? low.endUs : high.endUs,
        );
      } else if (low && !low.delimiter) {
        add(classify(low.durationUs), high.startUs, low.endUs);
      }
      if (truncated) break;
    }
  } else {
    for (const interval of intervals) {
      if (interval.delimiter) continue;
      const cells = Math.round(interval.durationUs / options.shortUs);
      if (
        cells < 1 ||
        cells > 256 ||
        Math.abs(interval.durationUs / options.shortUs - cells) > 0.25
      )
        add("?", interval.startUs, interval.endUs);
      else
        for (let cell = 0; cell < cells; cell++) {
          // Distribute cells over the actual measured run, not ideal clock
          // widths, so successive spans always meet at captured edges.
          add(
            interval.high ? "1" : "0",
            interval.startUs + (interval.durationUs * cell) / cells,
            cell === cells - 1
              ? interval.endUs
              : interval.startUs + (interval.durationUs * (cell + 1)) / cells,
          );
          if (truncated) break;
        }
      if (truncated) break;
    }
  }
  return result();
}
/** String-only compatibility interface for exports and existing consumers. */
export function interpretBurst(
  burst: OokBurst,
  options: OokOptions,
): string | null {
  return interpretBurstWithTiming(burst, options).bits;
}
export function burstHex(bits: string | null): string | null {
  if (!bits || /[^01]/.test(bits) || bits.length % 8) return null;
  return bits
    .match(/.{8}/g)!
    .map((b) => parseInt(b, 2).toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

/** Human-readable, MSB-first dumps of the interpreted stream. Keep byte
 * positions even when timings are unknown; never invent padding bits. */
export function formatOokDump(bits: string | null): {
  binary: string;
  hex: string;
  bitCount: number;
  unknownBits: number;
  partialByteBits: number;
  trailingBits: string;
  truncated: boolean;
  groups: { startBit: number; endBit: number; binary: string; hex: string }[];
} | null {
  if (bits === null) return null;
  const truncated = bits.endsWith("…");
  const data = truncated ? bits.slice(0, -1) : bits;
  const bytes = data.match(/.{1,8}/g) ?? [];
  const hex = bytes.map((byte) =>
    (byte.match(/.{1,4}/g) ?? [])
      .map((nibble) => {
        if (nibble.length < 4) return `[${nibble}]`;
        return /^[01]{4}$/.test(nibble)
          ? parseInt(nibble, 2).toString(16).toUpperCase()
          : "?";
      })
      .join(""),
  );
  const rows = (values: string[]) => {
    const lines: string[] = [];
    for (let i = 0; i < values.length; i += 4)
      lines.push(values.slice(i, i + 4).join(" "));
    if (truncated) lines.push("…");
    return lines.join("\n");
  };
  return {
    binary: rows(bytes),
    hex: rows(hex),
    bitCount: data.length,
    unknownBits: (data.match(/\?/g) ?? []).length,
    partialByteBits: data.length % 8,
    trailingBits: data.length % 4 ? data.slice(-(data.length % 4)) : "",
    truncated,
    groups: bytes.map((binary, i) => ({
      startBit: i * 8,
      endBit: i * 8 + binary.length,
      binary,
      hex: hex[i],
    })),
  };
}
/** rtl_433's documented pulse/gap text format. Last idle is a lower bound. */
export function ookText(c: OokCapture): string {
  const rows = [
    ";pulse data",
    ";version 1",
    ";timescale 1us",
    `;ook ${Math.ceil(c.durations.length / 2)} pulses`,
    `;freq1 ${c.frequency}`,
    `; Generated test: ${c.test ? "yes" : "no"}`,
    `; Received ${c.receivedAt}`,
    c.durations.length % 2
      ? "; Final low gap was not captured; exported 0 is a missing-gap placeholder."
      : c.gapLowerBound
        ? "; Final gap is an observed lower bound; no device protocol/checksum verified."
        : "; Measured pulse/gap timings; no device protocol/checksum verified.",
  ];
  for (let i = 0; i < c.durations.length; i += 2)
    rows.push(
      `${Math.round(c.durations[i])} ${Math.round(c.durations[i + 1] ?? 0)}`,
    );
  rows.push(";end");
  return rows.join("\n") + "\n";
}
