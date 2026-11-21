/** Discoverable decoder manifests. Only implemented modules appear in Decode as. */
export type DecoderId =
  | "none"
  | "wfm"
  | "wwv"
  | "am"
  | "armer"
  | "nfm"
  | "ook"
  | "rtl433";
export interface DecoderManifest {
  id: DecoderId;
  name: string;
  description: string;
  requirements: {
    minSampleRate: number;
    bandwidthHz: number;
    inputSampleRate?: number;
  };
  outputs: ("audio" | "telemetry" | "timecode" | "sync" | "message")[];
  bandwidths: number[];
}
export const decoders: DecoderManifest[] = [
  {
    id: "none",
    name: "None · spectrum only",
    description: "Inspect the spectrum without decoding audio.",
    requirements: { minSampleRate: 0, bandwidthHz: 0 },
    outputs: [],
    bandwidths: [],
  },
  {
    id: "wfm",
    name: "WFM · broadcast FM",
    description: "Wideband FM · auto stereo · 48 kHz",
    requirements: {
      minSampleRate: 240000,
      bandwidthHz: 200000,
      inputSampleRate: 2400000,
    },
    outputs: ["audio", "telemetry"],
    bandwidths: [150000, 180000, 200000, 220000],
  },
  {
    id: "am",
    name: "AM · amplitude modulation",
    description: "AM envelope audio · mono · 48 kHz",
    requirements: {
      minSampleRate: 48000,
      bandwidthHz: 10000,
      inputSampleRate: 2400000,
    },
    outputs: ["audio"],
    bandwidths: [6000, 8000, 10000, 12000, 16000],
  },
  {
    id: "nfm",
    name: "NFM · narrowband FM",
    description: "Analog FM voice · squelch · CTCSS / DCS",
    requirements: {
      minSampleRate: 24000,
      bandwidthHz: 12500,
      inputSampleRate: 2400000,
    },
    outputs: ["audio", "telemetry", "message"],
    bandwidths: [10000, 12500, 15000, 20000, 25000],
  },
  {
    id: "ook",
    name: "OOK / ASK · pulse data",
    description: "Binary amplitude keying · pulse timings + configurable bits",
    requirements: {
      minSampleRate: 240000,
      bandwidthHz: 50000,
      inputSampleRate: 2400000,
    },
    outputs: ["telemetry", "message"],
    bandwidths: [10000, 25000, 50000, 100000],
  },
  {
    id: "rtl433",
    name: "rtl_433 · ISM devices",
    description: "OOK + FSK device protocols · structured JSON messages",
    requirements: {
      minSampleRate: 240000,
      bandwidthHz: 200000,
      inputSampleRate: 2400000,
    },
    outputs: ["message", "telemetry"],
    bandwidths: [50000, 100000, 150000, 200000],
  },
  {
    id: "armer",
    name: "ARMER · P25 Phase I",
    description: "P25 C4FM trunk tracking · IMBE audio + talkgroups",
    requirements: {
      minSampleRate: 2400000,
      bandwidthHz: 12500,
      inputSampleRate: 2400000,
    },
    outputs: ["audio", "telemetry", "message"],
    bandwidths: [12500],
  },
  {
    id: "wwv",
    name: "WWV · NIST time code",
    description: "AM audio + 100 Hz digital UTC time code",
    requirements: {
      minSampleRate: 48000,
      bandwidthHz: 10000,
      inputSampleRate: 2400000,
    },
    outputs: ["audio", "timecode", "sync"],
    bandwidths: [6000, 10000, 12000],
  },
];
export const receiverCapabilities = {
  sampleRate: 2400000,
  minHz: 24000000,
  maxHz: 1766000000,
};
export function compatibility(
  manifest: DecoderManifest,
  receiver = receiverCapabilities,
): string | null {
  if (manifest.requirements.minSampleRate > receiver.sampleRate)
    return `Needs ${(manifest.requirements.minSampleRate / 1e6).toFixed(1)} MSPS; this receiver captures ${(receiver.sampleRate / 1e6).toFixed(1)} MSPS.`;
  if (manifest.requirements.bandwidthHz > receiver.sampleRate)
    return "Decoder bandwidth exceeds the captured band.";
  if (
    manifest.requirements.inputSampleRate &&
    manifest.requirements.inputSampleRate !== receiver.sampleRate
  )
    return `This decoder pipeline currently requires ${manifest.requirements.inputSampleRate / 1e6} MSPS input.`;
  return null;
}
export const wwvFrequencies = [
  2500000, 5000000, 10000000, 15000000, 20000000, 25000000,
];
