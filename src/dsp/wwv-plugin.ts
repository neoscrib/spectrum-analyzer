import init, { WwvDecoder } from "../wasm/wwv";
import { initCore, createChannelizer } from "./channelizer";
import type { Settings } from "../model";
import type { DecoderEvent, WwvStatus } from "../types";
import type { DecoderPlugin } from "./plugins";
export async function wwvPlugin(s: Settings): Promise<DecoderPlugin> {
  await Promise.all([init(), initCore()]);
  const front = createChannelizer(s);
  const native = new WwvDecoder(s.channel - s.center, s.bandwidth);
  let lastStatus = -Infinity;
  return {
    process(iq, firstSample) {
      const samples = native.process_baseband(front.process(iq));
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
    dispose() {
      native.free();
      front.free();
    },
  };
}
