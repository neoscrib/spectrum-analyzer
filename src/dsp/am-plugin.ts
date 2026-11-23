import init, { AmDecoder } from "../wasm/am";
import { initCore, createChannelizer } from "./channelizer";
import type { Settings } from "../model";
import type { DecoderPlugin } from "./plugins";
export async function amPlugin(s: Settings): Promise<DecoderPlugin> {
  await Promise.all([init(), initCore()]);
  const front = createChannelizer(s);
  const native = new AmDecoder(s.channel - s.center, s.bandwidth);
  return {
    process(iq, firstSample) {
      return [
        {
          type: "audio",
          samples: native.process_baseband(front.process(iq)),
          sampleRate: 48000,
          channels: 2,
          firstSample,
        },
      ];
    },
    dispose() {
      native.free();
      front.free();
    },
  };
}
