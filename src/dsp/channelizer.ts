import init, { Channelizer } from "../wasm/dsp_core";
import type { Settings } from "../model";

export const initCore = () => init();

/** Match the existing native front ends exactly. DSP runs once per block in
 * dsp_core; only baseband at 1/10 the sample rate crosses into decoder memory. */
export function createChannelizer(s: Settings): Channelizer {
  const offset = s.channel - s.center;
  switch (s.decoder) {
    case "wfm":
      return new Channelizer(
        offset,
        Math.max(
          65000,
          Math.min(220000, Math.max(150000, s.bandwidth)) / 2 - 5000,
        ),
        401,
        10,
      );
    case "am":
    case "wwv":
      return new Channelizer(offset, 90000, 121, 10);
    case "ook":
      return new Channelizer(offset, 90000, 161, 10);
    default:
      throw Error("This decoder uses its own channelizer.");
  }
}
