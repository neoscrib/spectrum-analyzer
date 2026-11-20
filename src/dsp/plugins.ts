import {
  AmDecoder,
  WfmDecoder,
  WwvDecoder,
  Receiver,
} from "../wasm/spectrum_dsp";
import type { Settings } from "../model";
import type { DecoderEvent, WwvStatus } from "../types";
import { ControlQualityWindow } from "../armer/quality";
import { nfmPlugin } from "./nfm-plugin";
import {
  policyBitmap,
  type ArmerPolicy,
  type P25Event,
  type P25Stats,
} from "../armer/model";

/** A worker-owned instance, recreated on configuration/revision changes.
 * CU8 inputs remain worker-owned. Output buffers transfer ownership to consumers.
 * Metadata never aliases WASM memory. dispose() releases all native state. */
export interface DecoderPlugin {
  process(iq: Uint8Array, firstSample: number): DecoderEvent[];
  dispose(): void;
  setPolicy?(policy: ArmerPolicy): void;
  setHold?(id: string | null): void;
}
export const factories: Record<
  Exclude<Settings["decoder"], "none">,
  (s: Settings, policy?: ArmerPolicy) => DecoderPlugin
> = {
  nfm(s) {
    return nfmPlugin(s);
  },
  armer(s, policy = { defaultListen: true, rules: [] }) {
    const native = new Receiver(s.center, s.channel, 2400000);
    const quality = new ControlQualityWindow();
    const setPolicy = (p: ArmerPolicy) => {
      if (!native.set_enabled(policyBitmap(p)))
        throw Error("Invalid ARMER listen policy.");
      previous = undefined;
      lastAudioSample = -Infinity;
      lastAudioTalkgroup = 0;
    };
    let previous: number | undefined,
      lastAudioSample = -Infinity,
      lastAudioTalkgroup = 0;
    let valid = 0,
      lastValidSeconds = -Infinity;
    setPolicy(policy);
    return {
      process(iq, firstSample) {
        native.process(iq);
        const events: DecoderEvent[] = JSON.parse(native.take_events()).map(
          (event: P25Event) => ({ type: "message", protocol: "armer", event }),
        );
        const pcm = native.take_audio();
        if (pcm.length) {
          const talkgroup = native.audio_talkgroup();
          if (talkgroup !== lastAudioTalkgroup) previous = undefined;
          const samples = new Float32Array(pcm.length * 12);
          let at = 0;
          for (const value of pcm) {
            const from = previous ?? value;
            for (let i = 1; i <= 6; i++) {
              const v = from + ((value - from) * i) / 6;
              samples[at++] = v;
              samples[at++] = v;
            }
            previous = value;
          }
          events.push({
            type: "audio",
            samples,
            sampleRate: 48000,
            channels: 2,
            firstSample,
          });
          lastAudioSample = firstSample;
          lastAudioTalkgroup = talkgroup;
        }
        const stats: P25Stats = JSON.parse(native.stats());
        if (stats.valid > valid) {
          valid = stats.valid;
          lastValidSeconds = stats.seconds;
        }
        events.push({
          type: "telemetry",
          protocol: "armer",
          status: {
            ...stats,
            quality: quality.update(stats),
            controlLocked:
              stats.valid > 0 && stats.seconds - lastValidSeconds < 2,
            audioTalkgroup:
              stats.channels > 0 && firstSample - lastAudioSample < 1200000
                ? lastAudioTalkgroup
                : 0,
          },
        });
        return events;
      },
      setPolicy,
      dispose: () => native.free(),
    };
  },
  am(s) {
    const native = new AmDecoder(s.channel - s.center, s.bandwidth);
    return {
      process(iq, firstSample) {
        return [
          {
            type: "audio",
            samples: native.process(iq),
            sampleRate: 48000,
            channels: 2,
            firstSample,
          },
        ];
      },
      dispose: () => native.free(),
    };
  },
  wfm(s) {
    const native = new WfmDecoder(
      s.channel - s.center,
      s.bandwidth,
      s.deemphasis,
    );
    native.set_stereo_enabled(s.stereo);
    return {
      process(iq, firstSample) {
        const samples = native.process(iq);
        return [
          {
            type: "audio",
            samples,
            sampleRate: 48000,
            channels: 2,
            firstSample,
          },
          {
            type: "telemetry",
            protocol: "wfm",
            stereo: native.stereo_locked(),
            pilotLevel: native.pilot_level(),
          },
        ];
      },
      dispose: () => native.free(),
    };
  },
  wwv(s) {
    const native = new WwvDecoder(s.channel - s.center, s.bandwidth);
    let lastStatus = -Infinity;
    return {
      process(iq, firstSample) {
        const samples = native.process(iq);
        const events: DecoderEvent[] = [
          {
            type: "audio",
            samples,
            sampleRate: 48000,
            channels: 2,
            firstSample,
          },
        ];
        // Use stream time so accelerated tests/replay preserve status transitions.
        if (firstSample - lastStatus >= 2400000 / 5) {
          const status: WwvStatus = JSON.parse(native.status());
          events.push(
            { type: "timecode", protocol: "wwv", status },
            {
              type: "sync",
              protocol: "wwv",
              locked: status.confirmed,
              state: status.confirmed
                ? "confirmed"
                : status.synchronized
                  ? "minute"
                  : "searching",
            },
          );
          lastStatus = firstSample;
        }
        return events;
      },
      dispose: () => native.free(),
    };
  },
};
