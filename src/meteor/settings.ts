import type { Settings } from "./types";
export const SATELLITES = [
  {
    id: 59051,
    name: "Meteor-M2-4",
    note: "Reported LRPT active · 137.9 MHz / 72k · verify before pass",
  },
  {
    id: 57166,
    name: "Meteor-M2-3",
    note: "Reported LRPT active · antenna deployment issue; signal can vary",
  },
  {
    id: 40069,
    name: "Meteor-M2 (legacy)",
    note: "Historical QPSK profile · LRPT not an active reception target",
  },
  {
    id: 44387,
    name: "Meteor-M2-2",
    note: "LRPT unavailable following 2019 damage; historical profile",
  },
];
export const GAINS = [
  0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9,
  25.4, 28, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5,
  48, 49.6,
];
export const DEFAULT_SETTINGS: Settings = {
  satellite: 59051,
  frequency: 137900000,
  center: 137750000,
  sampleRate: 1200000,
  symbolRate: 72000,
  mode: "oqpsk",
  nrzm: true,
  interleaved: false,
  gain: 25.4,
  ppm: 0,
  doppler: true,
  frequencyBiasHz: 0,
  latitude: 45.8769,
  longitude: -93.2938,
  altitude: 309,
  minElevation: 10,
  tle: "",
  replayFormat: "cu8",
};
export function validateSettings(s: Settings): string | undefined {
  if (
    s.frequencyBiasHz !== undefined &&
    (!Number.isFinite(s.frequencyBiasHz) ||
      Math.abs(s.frequencyBiasHz) > 100000)
  )
    return "Frequency bias must be between −100,000 and +100,000 Hz.";
  if (
    s.carrierLimitHz !== undefined &&
    (!Number.isFinite(s.carrierLimitHz) ||
      s.carrierLimitHz < 50 ||
      s.carrierLimitHz > 8000)
  )
    return "Residual carrier search must be 50–8,000 Hz, or blank for the default.";
  const numbers = [
    "frequency",
    "center",
    "sampleRate",
    "symbolRate",
    "gain",
    "ppm",
    "latitude",
    "longitude",
    "altitude",
    "minElevation",
  ] as const;
  if (numbers.some((k) => !Number.isFinite(s[k])))
    return "Settings must contain finite numbers.";
  if (
    !SATELLITES.some((x) => x.id === s.satellite) ||
    !["cu8", "cs16", "cf32"].includes(s.replayFormat) ||
    ["nrzm", "interleaved", "doppler"].some(
      (k) => typeof s[k as keyof Settings] !== "boolean",
    )
  )
    return "Invalid satellite, format or mode switches.";
  if (
    s.frequency < 130e6 ||
    s.frequency > 140e6 ||
    s.center < 130e6 ||
    s.center > 140e6
  )
    return "Tune between 130 and 140 MHz.";
  if (
    s.sampleRate < 180000 ||
    s.sampleRate > 2400000 ||
    !Number.isInteger(s.sampleRate)
  )
    return "Sample rate must be 180,000–2,400,000 samples/s.";
  if (
    s.sampleRate >= 600000 &&
    s.sampleRate % Math.floor(s.sampleRate / 240000) !== 0
  )
    return "Sample rate must permit integer decimation.";
  if (
    Math.abs(s.frequency + (s.frequencyBiasHz ?? 0) - s.center) + 80000 >
    s.sampleRate / 2
  )
    return "The full LRPT signal must fit inside the recorded bandwidth. Move center closer to the downlink.";
  if (![72000, 80000].includes(s.symbolRate))
    return "Choose 72,000 or 80,000 symbols/s.";
  if (!["oqpsk", "qpsk"].includes(s.mode)) return "Choose QPSK or OQPSK.";
  if (s.gain < 0 || s.gain > 49.6 || Math.abs(s.ppm) > 200)
    return "Gain must be 0–49.6 dB and PPM −200 to +200.";
  if (
    Math.abs(s.latitude) > 90 ||
    Math.abs(s.longitude) > 180 ||
    s.altitude < -500 ||
    s.altitude > 10000
  )
    return "Enter a valid observer latitude, longitude and elevation in meters.";
  if (s.minElevation < 0 || s.minElevation > 85)
    return "Pass elevation threshold must be 0–85°.";
}
export function loadSettings(): Settings {
  try {
    const s = {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(localStorage.getItem("meteor-settings-v1") ?? "{}"),
    };
    return validateSettings(s) ? { ...DEFAULT_SETTINGS } : s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(s: Settings): void {
  if (!validateSettings(s))
    try {
      localStorage.setItem("meteor-settings-v1", JSON.stringify(s));
    } catch {
      /* Private browsing or full storage: current session still works. */
    }
}
export const CHANNEL_NAMES = [
  "Visible · 0.60 µm",
  "Near IR · 0.90 µm",
  "Shortwave IR · 1.70 µm",
  "Midwave IR · 3.80 µm",
  "Thermal IR · 11.0 µm",
  "Thermal IR · 12.0 µm",
];
