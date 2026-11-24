import init, { WfmDecoder } from "../wasm/wfm";
import { initCore, createChannelizer } from "./channelizer";
import type { Settings } from "../model";
import type { DecoderPlugin } from "./plugins";
import type { DecoderEvent } from "../types";
import type { RdsStatus } from "../rds/model";
import { MultiplexAnalyzer } from "./multiplex-spectrum";
export async function wfmPlugin(s: Settings): Promise<DecoderPlugin> {
  await Promise.all([init(), initCore()]);
  const front = createChannelizer(s);
  const native = new WfmDecoder(
    s.channel - s.center,
    s.bandwidth,
    s.deemphasis,
  );
  native.set_stereo_enabled(s.stereo);
  native.set_rds_enabled(s.rds);
  let samplesSinceRds = 0,
    rdsDue = true;
  let multiplex: MultiplexAnalyzer | undefined;
  let samplesSinceSpectrum = 0;
  return {
    setMultiplexEnabled(enabled) {
      if (enabled === !!multiplex) return;
      multiplex = enabled
        ? new MultiplexAnalyzer(native.multiplex_sample_rate())
        : undefined;
      native.set_multiplex_enabled(enabled);
      samplesSinceSpectrum = 0;
    },
    setStereoEnabled(enabled) {
      native.set_stereo_enabled(enabled);
    },
    setRdsEnabled(enabled) {
      native.set_rds_enabled(enabled);
      rdsDue = true;
    },
    process(iq, firstSample) {
      const baseband = front.process(iq);
      const samples = native.process_baseband(baseband);
      samplesSinceRds += baseband.length / 2;
      let rds: RdsStatus | undefined;
      if (rdsDue || samplesSinceRds >= native.multiplex_sample_rate() / 5) {
        rds = JSON.parse(native.rds_status()) as RdsStatus;
        samplesSinceRds = 0;
        rdsDue = false;
      }
      const events: DecoderEvent[] = [
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
          rds,
        },
      ];
      if (multiplex) {
        const tap = native.take_multiplex();
        multiplex.push(tap);
        samplesSinceSpectrum += tap.length;
        // Analyze every sample, but publish at most 10 spectra per source second.
        if (
          multiplex.averages &&
          samplesSinceSpectrum >= multiplex.sampleRate / 10
        ) {
          events.push({
            type: "spectrum",
            protocol: "wfm",
            multiplex: multiplex.snapshot(),
          });
          samplesSinceSpectrum = 0;
        }
      }
      return events;
    },
    dispose() {
      native.free();
      front.free();
    },
  };
}
