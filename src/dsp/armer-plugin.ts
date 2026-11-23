import init, { Receiver } from "../wasm/armer";
import type { Settings } from "../model";
import type { DecoderEvent } from "../types";
import type { DecoderPlugin } from "./plugins";
import { ControlQualityWindow } from "../armer/quality";
import {
  policyBitmap,
  type ArmerPolicy,
  type P25Event,
  type P25Stats,
  type SystemInformation,
} from "../armer/model";
export async function armerPlugin(
  s: Settings,
  policy: ArmerPolicy = { defaultListen: true, rules: [] },
): Promise<DecoderPlugin> {
  await init();
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
  let information: SystemInformation | undefined,
    lastInformation = -Infinity;
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
      if (firstSample - lastInformation >= 480000) {
        information = JSON.parse(native.information());
        lastInformation = firstSample;
      }
      if (stats.valid > valid) {
        valid = stats.valid;
        lastValidSeconds = stats.seconds;
      }
      events.push({
        type: "telemetry",
        protocol: "armer",
        status: {
          ...stats,
          calls: JSON.parse(native.activity()),
          information,
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
    recenter(s) {
      if (!native.recenter(s.center))
        throw Error(
          "Auto-centering must keep the control channel inside the capture.",
        );
      previous = undefined;
      lastAudioSample = -Infinity;
      lastAudioTalkgroup = 0;
    },
    dispose: () => native.free(),
  };
}
