import init, { AmDecoder } from "../wasm/am";
import { initCore, createChannelizer } from "./channelizer";
import type { Settings } from "../model";
import type { DecoderPlugin } from "./plugins";
import { SameAudio } from "./same-audio";
export async function amPlugin(s: Settings): Promise<DecoderPlugin> {
  await Promise.all([init(), initCore()]);
  const front = createChannelizer(s);
  const native = new AmDecoder(s.channel - s.center, s.bandwidth);
  const same = new SameAudio(48000, "am", s.channel);
  let sameEnabled = false;
  let disposed = false;
  const setSameOptions = async (options: Settings["same"]) => {
    sameEnabled = options.enabled;
    await same.configure(options);
    if (!disposed) native.set_audio_tap_enabled(same.active);
  };
  await setSameOptions(s.same);
  return {
    setSameOptions,
    finish: () => same.finish(),
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
        ...(sameEnabled
          ? same.process(native.take_audio_tap(), firstSample / 2400000)
          : []),
      ];
    },
    dispose() {
      disposed = true;
      same.dispose();
      native.free();
      front.free();
    },
  };
}
