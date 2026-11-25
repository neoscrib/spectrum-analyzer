export const SAMPLE_RATE = 2_400_000;
import { adsbDefaults, validateAdsb, type AdsbOptions } from "./adsb/model";
import { defaultLiveDoppler } from "./meteor/live-doppler";
import { sameDefaults, type SameOptions } from "./same/model";
export const AUDIO_RATE = 48_000;
export const FFT_SIZE = 8192;
import { decoders, type DecoderId } from "./decoders";
import { validateTone, type ToneFilter } from "./presets/tones";
export { decoders, type DecoderId } from "./decoders";
import { ookDefaults, validateOok, type OokOptions } from "./ook/model";
import {
  rtl433Defaults,
  validateRtl433,
  type Rtl433Options,
} from "./rtl433/model";
import {
  meteorDefaults,
  validateMeteor,
  type MeteorOptions,
} from "./meteor/model";
export interface Settings {
  adsb: AdsbOptions;
  same: SameOptions;
  meteor: MeteorOptions;
  armerAutoCenter: boolean;
  rtl433: Rtl433Options;
  ook: OokOptions;
  center: number;
  span: number;
  channel: number;
  bandwidth: number;
  decoder: DecoderId;
  deemphasis: number;
  stereo: boolean;
  rds: boolean;
  gain: number | null;
  ppm: number;
  squelch: number | null;
  nfmDeviation: number;
  tone: ToneFilter | null;
}
export const defaults: Settings = {
  adsb: adsbDefaults,
  same: sameDefaults,
  meteor: meteorDefaults,
  armerAutoCenter: true,
  rtl433: rtl433Defaults,
  ook: ookDefaults,
  center: 100_000_000,
  span: SAMPLE_RATE,
  channel: 100_100_000,
  bandwidth: 200_000,
  decoder: "wfm",
  deemphasis: 75,
  stereo: true,
  rds: true,
  gain: 25.4,
  ppm: 0,
  squelch: -65,
  nfmDeviation: 2500,
  tone: null,
};
export function validateSettings(s: Settings): void {
  validateAdsb(s.adsb);
  if (
    !s.same ||
    typeof s.same.enabled !== "boolean" ||
    typeof s.same.attention !== "boolean"
  )
    throw Error("Choose whether to decode SAME and attention tones.");
  if (typeof s.armerAutoCenter !== "boolean")
    throw Error("Choose whether ARMER should auto-center active talkgroups.");
  validateMeteor(s.meteor);
  validateRtl433(s.rtl433);
  validateOok(s.ook);
  if (!Number.isFinite(s.center) || s.center <= 0 || s.center > 100e9)
    throw Error(
      "Center frequency must be positive and no greater than 100 GHz. Receiver tuning limits are checked when connecting.",
    );
  if (!Number.isFinite(s.span) || s.span < 25_000 || s.span > SAMPLE_RATE)
    throw Error("Displayed bandwidth must be between 25 kHz and 2.4 MHz.");
  const manifest = decoders.find((d) => d.id === s.decoder);
  if (!manifest) throw Error("Unknown decoder.");
  if (
    !Number.isFinite(s.bandwidth) ||
    s.bandwidth <= 0 ||
    s.bandwidth > SAMPLE_RATE
  )
    throw Error("Invalid decoder channel bandwidth.");
  if (s.decoder === "adsb" && s.channel !== 1090000000)
    throw Error(
      "1090ES decodes at 1090 MHz. Adjust the capture center or RF gain instead.",
    );
  if (s.decoder !== "none" && !manifest.bandwidths.includes(s.bandwidth))
    throw Error(
      `Choose a supported ${s.decoder.toUpperCase()} channel bandwidth.`,
    );
  if (
    !Number.isFinite(s.channel) ||
    Math.abs(s.channel - s.center) +
      (s.decoder === "armer" ? 24000 : s.bandwidth / 2) >
      SAMPLE_RATE / 2
  )
    throw Error(
      "Keep the whole decoder channel inside the 2.4 MHz captured band.",
    );
  if (
    s.gain !== null &&
    (!Number.isFinite(s.gain) || s.gain < -100 || s.gain > 150)
  )
    throw Error(
      "Enter a valid gain from −100 to 150 dB. Receiver gain limits are checked when connecting.",
    );
  if (!Number.isFinite(s.ppm) || Math.abs(s.ppm) > 200)
    throw Error("Frequency correction must be between −200 and +200 ppm.");
  if (![0, 50, 75].includes(s.deemphasis))
    throw Error("Choose 50 µs, 75 µs, or no de-emphasis.");
  if (typeof s.stereo !== "boolean")
    throw Error("Choose Auto stereo or Mono audio.");
  if (typeof s.rds !== "boolean")
    throw Error("Choose whether to decode RDS/RBDS.");
  if (
    s.squelch !== null &&
    (!Number.isFinite(s.squelch) || s.squelch < -100 || s.squelch > -20)
  )
    throw Error("Choose squelch Off or a threshold from −100 to −20 dBFS.");
  if (![2500, 5000, 7500].includes(s.nfmDeviation))
    throw Error("Choose a supported FM deviation.");
  validateTone(s.tone);
  if (!decoders.some((d) => d.id === s.decoder))
    throw Error("Unknown decoder.");
}
export function moveCenter(s: Settings, center: number): Settings {
  // A trunking control channel is an absolute frequency. Repositioning its RF
  // capture must not silently move that known control channel to another MHz.
  return {
    ...s,
    center,
    channel:
      s.decoder === "armer" || s.decoder === "adsb"
        ? s.channel
        : center + (s.channel - s.center),
  };
}
export function clampChannel(s: Settings, channel: number): number {
  const edge = SAMPLE_RATE / 2 - s.bandwidth / 2;
  return (
    Math.round(
      Math.max(s.center - edge, Math.min(s.center + edge, channel)) / 1000,
    ) * 1000
  );
}
export function frequencyAt(
  x: number,
  width: number,
  center: number,
  span: number,
): number {
  return center + (Math.max(0, Math.min(1, x / width)) - 0.5) * span;
}
export function binRange(
  x: number,
  pixels: number,
  size: number,
  span: number,
  sampleRate = SAMPLE_RATE,
): [number, number] {
  const start = ((1 - span / sampleRate) / 2) * size;
  const binsPerPixel = ((span / sampleRate) * size) / pixels;
  const lo = Math.max(
    0,
    Math.min(size - 1, Math.floor(start + x * binsPerPixel)),
  );
  return [
    lo,
    Math.max(lo + 1, Math.min(size, Math.ceil(start + (x + 1) * binsPerPixel))),
  ];
}
export function readSettings(): Settings {
  try {
    const saved = {
      ...defaults,
      ...JSON.parse(localStorage.getItem("spectrum-settings") || "{}"),
    };
    // Enable the new default once for existing app preferences, then retain
    // subsequent explicit opt-outs. Capture/recovery metadata is not migrated.
    const meteor = { ...meteorDefaults, ...saved.meteor };
    if (saved.meteor?.autoBiasDefaultVersion !== 1) {
      meteor.autoBias = true;
      meteor.autoBiasDefaultVersion = 1;
    }
    meteor.dopplerPreference =
      saved.meteor?.dopplerPreference ??
      (saved.meteor?.doppler ? "on" : "auto");
    saved.meteor = defaultLiveDoppler(meteor);
    saved.same = { ...sameDefaults, ...saved.same };
    saved.adsb = { ...adsbDefaults, ...saved.adsb };
    validateSettings(saved);
    return saved;
  } catch {
    return { ...defaults };
  }
}
