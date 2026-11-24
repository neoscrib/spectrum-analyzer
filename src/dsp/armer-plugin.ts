import init, { Receiver } from "../wasm/armer";
import type { Settings } from "../model";
import type { DecoderEvent } from "../types";
import type { DecoderPlugin } from "./plugins";
import { ControlQualityWindow } from "../armer/quality";
import {
  policyBitmap,
  voiceLimit,
  type ActiveCall,
  type ArmerAudioStream,
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
  const streams = new Map<
    number,
    { previous?: number; next: number; last: number; stream: ArmerAudioStream }
  >();
  const setPolicy = (p: ArmerPolicy) => {
    native.set_voice_limit(voiceLimit(p));
    if (!native.set_enabled(policyBitmap(p)))
      throw Error("Invalid ARMER listen policy.");
  };
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
      const chunks: (ArmerAudioStream & {
        start: number;
        offset: number;
        length: number;
      })[] = JSON.parse(native.take_audio_chunks());
      const pcm = native.take_audio();
      for (const chunk of chunks) {
        const old = streams.get(chunk.id);
        let previous = old?.next === chunk.start ? old.previous : undefined;
        const samples = new Float32Array(chunk.length * 12);
        let at = 0;
        for (const value of pcm.subarray(
          chunk.offset,
          chunk.offset + chunk.length,
        )) {
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
          armer: {
            id: chunk.id,
            talkgroup: chunk.talkgroup,
            frequency: chunk.frequency,
            startFrame: chunk.start * 6,
          },
        });
        streams.set(chunk.id, {
          previous,
          next: chunk.start + chunk.length,
          last: firstSample,
          stream: {
            id: chunk.id,
            talkgroup: chunk.talkgroup,
            frequency: chunk.frequency,
          },
        });
      }
      const stats: P25Stats = JSON.parse(native.stats());
      const calls: ActiveCall[] = JSON.parse(native.activity());
      const active = new Set(
        calls
          .filter((c) => c.selected && c.encrypted === false)
          .map((c) => c.streamId),
      );
      for (const [id, stream] of streams)
        if (!active.has(id) || firstSample - stream.last >= 1200000)
          streams.delete(id);
      const audioStreams = [...streams.values()].map((s) => s.stream);
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
          calls,
          information,
          quality: quality.update(stats),
          controlLocked:
            stats.valid > 0 && stats.seconds - lastValidSeconds < 2,
          audioTalkgroup: audioStreams[0]?.talkgroup ?? 0,
          audioStreams,
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
      streams.clear();
    },
    dispose: () => native.free(),
  };
}
