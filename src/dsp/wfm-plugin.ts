import init, { WfmDecoder } from "../wasm/wfm";
import { initCore, createChannelizer } from "./channelizer";
import type { Settings } from "../model";
import type { DecoderPlugin } from "./plugins";
export async function wfmPlugin(s: Settings): Promise<DecoderPlugin> {
  await Promise.all([init(), initCore()]);
  const front = createChannelizer(s);
  const native = new WfmDecoder(
    s.channel - s.center,
    s.bandwidth,
    s.deemphasis,
  );
  native.set_stereo_enabled(s.stereo);
  return {
    process(iq, firstSample) {
      const samples = native.process_baseband(front.process(iq));
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
    dispose() {
      native.free();
      front.free();
    },
  };
}
