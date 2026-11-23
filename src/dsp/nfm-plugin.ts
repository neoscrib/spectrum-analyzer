import init, { NfmDecoder } from "../wasm/nfm";
import type { Settings } from "../model";
import type { DecoderEvent } from "../types";
import {
  matchesTone,
  type FrequencyPreset,
  type NfmMonitorConfig,
  type NfmChannelStatus,
} from "../presets/model";
import type { DecoderPlugin } from "./plugins";

export async function nfmPlugin(
  settings: Settings,
  monitor: NfmMonitorConfig | null = null,
): Promise<DecoderPlugin> {
  await init();
  const presets: FrequencyPreset[] = monitor?.presets ?? [
    {
      id: "single",
      name: "NFM",
      frequency: settings.channel,
      decoder: "nfm",
      bandwidth: settings.bandwidth,
      deviation: settings.nfmDeviation,
      squelch: settings.squelch,
      tone: settings.tone,
      enabled: true,
    },
  ];
  if (!presets.length || presets.length > 16)
    throw Error("Monitor 1–16 NFM presets per capture window.");
  for (const preset of presets)
    if (
      preset.decoder !== "nfm" ||
      Math.abs(preset.frequency - settings.center) + preset.bandwidth / 2 >
        1200000 - 24000
    )
      throw Error("All virtual receivers must fit inside the 2.4 MHz capture.");
  const receivers = presets.map((preset) => ({
    preset,
    native: new NfmDecoder(
      preset.frequency - settings.center,
      preset.bandwidth,
      preset.deviation,
      preset.squelch ?? -120,
    ),
    wasActive: false,
    fade: 0,
  }));
  let selectedId: string | null = null,
    holdId = monitor?.holdId ?? null;
  return {
    setHold(id) {
      holdId = id;
    },
    process(iq, firstSample) {
      const events: DecoderEvent[] = [];
      const channels: NfmChannelStatus[] = [];
      const audio = new Map<string, Float32Array>();
      for (const receiver of receivers) {
        const { preset, native } = receiver;
        const samples = native.process(iq);
        const measured = JSON.parse(native.status()) as Omit<
          NfmChannelStatus,
          "id" | "frequency"
        >;
        const status: NfmChannelStatus = {
          ...measured,
          id: preset.id,
          frequency: preset.frequency,
          open: measured.open && matchesTone(preset.tone, measured),
        };
        // A tone filter is optional. Detection never implies encryption/privacy.
        for (let n = 0; n < samples.length; n += 2) {
          receiver.fade += Math.max(
            -1 / 240,
            Math.min(1 / 240, Number(status.open) - receiver.fade),
          );
          samples[n] *= receiver.fade;
          samples[n + 1] *= receiver.fade;
        }
        channels.push(status);
        audio.set(preset.id, samples);
        if (status.carrier !== receiver.wasActive) {
          events.push({
            type: "activity",
            protocol: "nfm",
            event: {
              id: preset.id,
              frequency: preset.frequency,
              open: status.carrier,
              seconds: measured.seconds,
              level: measured.level,
              ctcss: measured.ctcss,
              dcs: measured.dcs,
            },
          });
          receiver.wasActive = status.carrier;
        }
      }
      const next =
        holdId && channels.some((c) => c.id === holdId)
          ? holdId
          : !monitor
            ? "single"
            : (channels.find((c) => c.id === selectedId && c.open)?.id ??
              channels.find((c) => c.open)?.id ??
              null);
      if (next !== selectedId) {
        selectedId = next;
        events.push({ type: "selection", protocol: "nfm", id: next });
      }
      if (selectedId)
        events.push({
          type: "audio",
          samples: audio.get(selectedId)!,
          sampleRate: 48000,
          channels: 2,
          firstSample,
        });
      events.push({
        type: "telemetry",
        protocol: "nfm",
        status: {
          bankId: monitor?.bankId ?? null,
          windowKey: monitor?.windowKey ?? null,
          selectedId,
          channels,
          seconds: (firstSample + iq.length / 2) / 2400000,
        },
      });
      return events;
    },
    dispose() {
      for (const r of receivers) r.native.free();
    },
  };
}
