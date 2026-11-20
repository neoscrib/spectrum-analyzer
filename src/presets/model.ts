import {
  SAMPLE_RATE,
  defaults,
  validateSettings,
  type Settings,
} from "../model";
import { CTCSS, DCS_CODES, validateTone, type ToneFilter } from "./tones";
export { CTCSS, DCS_CODES, validateTone, type ToneFilter } from "./tones";
export interface FrequencyPreset {
  id: string;
  name: string;
  frequency: number;
  decoder: "nfm" | "am" | "wfm";
  bandwidth: number;
  deviation: number;
  squelch: number | null;
  tone: ToneFilter | null;
  enabled: boolean;
}
export interface PresetBank {
  id: string;
  name: string;
  presets: FrequencyPreset[];
  source?: string;
}
export interface PresetLibrary {
  version: 1;
  banks: PresetBank[];
}
export interface CaptureWindow {
  key: string;
  center: number;
  presets: FrequencyPreset[];
}
export interface NfmMonitorConfig {
  bankId: string;
  windowKey: string;
  presets: FrequencyPreset[];
  holdId: string | null;
}
export interface DcsCode {
  code: string;
  inverted: boolean;
}
export interface NfmChannelStatus {
  id: string;
  frequency: number;
  level: number;
  noise: number;
  carrier: boolean;
  open: boolean;
  ctcss: number | null;
  dcs: DcsCode[];
  seconds: number;
}
export interface NfmTelemetry {
  bankId: string | null;
  windowKey: string | null;
  selectedId: string | null;
  channels: NfmChannelStatus[];
  seconds: number;
}
export interface NfmActivity {
  id: string;
  frequency: number;
  open: boolean;
  seconds: number;
  level: number;
  ctcss: number | null;
  dcs: DcsCode[];
}
export interface NfmFeed {
  status: NfmTelemetry | null;
  events: NfmActivity[];
}
export interface ActivityRecord {
  id: string;
  presetId: string;
  name: string;
  frequency: number;
  started: number;
  duration: number;
  level: number;
  code: string;
  test: boolean;
  end: "active" | "squelch" | "retuned" | "stopped";
}
export const toneLabel = (ctcss: number | null, dcs: DcsCode[]) =>
  dcs.length
    ? dcs.map((d) => `${d.code}${d.inverted ? "I" : "N"}`).join(" / ")
    : ctcss
      ? `${ctcss.toFixed(1)} Hz CTCSS`
      : "No code detected";
export function matchesTone(
  filter: ToneFilter | null,
  status: Pick<NfmChannelStatus, "ctcss" | "dcs">,
) {
  return (
    !filter ||
    (filter.type === "ctcss"
      ? status.ctcss !== null && Math.abs(status.ctcss - filter.hz) < 0.05
      : status.dcs.some(
          (d) => d.code === filter.code && d.inverted === filter.inverted,
        ))
  );
}
export function validateLibrary(
  value: unknown,
): asserts value is PresetLibrary {
  const v = value as PresetLibrary;
  if (
    !v ||
    v.version !== 1 ||
    !Array.isArray(v.banks) ||
    v.banks.length < 1 ||
    v.banks.length > 50
  )
    throw Error("Use a version 1 preset library with 1–50 banks.");
  const ids = new Set<string>();
  let count = 0;
  for (const b of v.banks) {
    if (
      !b ||
      typeof b.id !== "string" ||
      !b.id.trim() ||
      b.id.length > 80 ||
      ids.has(b.id) ||
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 100 ||
      !Array.isArray(b.presets) ||
      b.presets.length > 200
    )
      throw Error("Invalid preset bank.");
    ids.add(b.id);
    if (
      b.source !== undefined &&
      (typeof b.source !== "string" || b.source.length > 300)
    )
      throw Error("Invalid bank source.");
    const presetIds = new Set<string>();
    for (const p of b.presets) {
      if (
        !p ||
        typeof p.id !== "string" ||
        !p.id.trim() ||
        p.id.length > 80 ||
        presetIds.has(p.id) ||
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.length > 120 ||
        !["nfm", "am", "wfm"].includes(p.decoder) ||
        !Number.isInteger(p.frequency) ||
        p.frequency < 24e6 ||
        p.frequency > 1766e6 ||
        ![2500, 5000, 7500].includes(p.deviation) ||
        (p.squelch !== null &&
          (!Number.isFinite(p.squelch) ||
            p.squelch < -100 ||
            p.squelch > -20)) ||
        typeof p.enabled !== "boolean"
      )
        throw Error(
          "Invalid frequency preset. Frequencies must be 24–1766 MHz.",
        );
      presetIds.add(p.id);
      validateTone(p.tone);
      validateSettings({
        ...defaults,
        decoder: p.decoder,
        bandwidth: p.bandwidth,
        channel: p.frequency,
        center: Math.max(24e6, p.frequency - 100000),
        squelch: p.squelch,
        nfmDeviation: p.deviation,
        tone: p.tone,
      });
      count++;
    }
  }
  if (count > 2000) throw Error("Use at most 2,000 frequency presets.");
}
/** At most sixteen parallel receivers per window, with margin from capture edges
 * and the DC notch. FRS/GMRS splits into exactly two RF windows (15 + 7). */
export function captureWindows(bank: PresetBank): CaptureWindow[] {
  const presets = bank.presets
    .filter((p) => p.enabled && p.decoder === "nfm")
    .sort((a, b) => a.frequency - b.frequency);
  const groups: FrequencyPreset[][] = [];
  for (const preset of presets) {
    let group = groups.at(-1);
    if (
      !group ||
      group.length >= 16 ||
      preset.frequency - group[0].frequency > SAMPLE_RATE - 100000
    ) {
      group = [];
      groups.push(group);
    }
    group.push(preset);
  }
  return groups.map((group) => {
    const lo = group[0].frequency,
      hi = group.at(-1)!.frequency;
    const spare = (SAMPLE_RATE - (hi - lo)) / 2 - 50000;
    const center = Math.round(
      Math.max(24e6, Math.min(1766e6, (lo + hi) / 2 - Math.min(250000, spare))),
    );
    return {
      key: JSON.stringify(group.map((p) => p.id)),
      center,
      presets: group,
    };
  });
}
export function presetSettings(p: FrequencyPreset, s: Settings): Settings {
  const fits =
    Math.abs(s.center - p.frequency) + p.bandwidth / 2 <
    SAMPLE_RATE / 2 - 24000;
  const center = fits
    ? s.center
    : Math.max(24e6, Math.min(1766e6, p.frequency - 100000));
  return {
    ...s,
    decoder: p.decoder,
    channel: p.frequency,
    center,
    bandwidth: p.bandwidth,
    squelch: p.squelch,
    nfmDeviation: p.deviation,
    tone: p.tone,
  };
}
const nfm = (
  id: string,
  name: string,
  frequency: number,
  bandwidth = 12500,
  deviation = 2500,
): FrequencyPreset => ({
  id,
  name,
  frequency,
  decoder: "nfm",
  bandwidth,
  deviation,
  squelch: -65,
  tone: null,
  enabled: true,
});
export function starterLibrary(): PresetLibrary {
  const frs = Array.from({ length: 22 }, (_, i) => {
    const ch = i + 1;
    return nfm(
      `frs-${ch}`,
      `Channel ${ch}`,
      ch <= 7
        ? 462562500 + i * 25000
        : ch <= 14
          ? 467562500 + (i - 7) * 25000
          : 462550000 + (i - 14) * 25000,
    );
  });
  return {
    version: 1,
    banks: [
      {
        id: "frs-gmrs",
        name: "FRS / GMRS · US",
        source:
          "https://www.ecfr.gov/current/title-47/chapter-I/subchapter-D/part-95/subpart-B/section-95.563",
        presets: frs,
      },
      {
        id: "noaa",
        name: "NOAA Weather Radio",
        source: "https://www.weather.gov/abr/nwr",
        presets: Array.from({ length: 7 }, (_, i) =>
          nfm(
            `noaa-${i}`,
            `Weather · ${(162.4 + i * 0.025).toFixed(3)} MHz`,
            162400000 + i * 25000,
            25000,
            5000,
          ),
        ),
      },
      {
        id: "amateur",
        name: "Amateur FM calling · US",
        source: "https://www.arrl.org/band-plan",
        presets: [
          nfm("ham-10m", "10 m · FM simplex", 29600000, 20000, 5000),
          nfm("ham-6m", "6 m · FM simplex", 52525000, 20000, 5000),
          nfm("ham-2m", "2 m · FM simplex", 146520000, 20000, 5000),
          nfm("ham-70cm", "70 cm · FM simplex", 446000000, 20000, 5000),
        ],
      },
      {
        id: "marine",
        name: "Marine VHF · US simplex",
        source: "https://navcen.uscg.gov/us-vhf-channel-information",
        presets: [
          [6, 156300000],
          [9, 156450000],
          [13, 156650000],
          [16, 156800000],
          [22, 157100000],
          [67, 156375000],
          [68, 156425000],
          [69, 156475000],
          [71, 156575000],
          [72, 156625000],
          [73, 156675000],
          [78, 156925000],
        ].map(([ch, f]) =>
          nfm(
            `marine-${ch}`,
            ch === 22
              ? "Channel 22A · USCG liaison"
              : ch === 16
                ? "Channel 16 · distress / calling"
                : ch === 78
                  ? "Channel 78A"
                  : `Channel ${ch}`,
            f,
            25000,
            5000,
          ),
        ),
      },
      { id: "custom", name: "My frequencies", presets: [] },
    ],
  };
}
export function loadLibrary(): PresetLibrary {
  try {
    const data = JSON.parse(
      localStorage.getItem("spectrum-presets-v1") ?? "null",
    );
    if (data) {
      validateLibrary(data);
      return data;
    }
  } catch {
    /* Recover invalid storage with starter banks. */
  }
  return starterLibrary();
}
