import init, { Channelizer } from "../wasm/dsp_core";
import type { Settings } from "../model";

export const initCore = () => init();

/** Match the native front ends. DSP runs once per block in
 * dsp_core; only baseband at 1/10 the sample rate crosses into decoder memory. */
export function createChannelizer(s: Settings): Channelizer {
  const offset = s.channel - s.center;
  switch (s.decoder) {
    case "wfm":
      return Channelizer.wfm(offset, s.bandwidth);
    case "am":
    case "wwv":
      return new Channelizer(offset, 90000, 121, 10);
    case "ook":
      return new Channelizer(offset, 90000, 161, 10);
    default:
      throw Error("This decoder uses its own channelizer.");
  }
}
