import { OokDecoder } from "../wasm/spectrum_dsp";
import type { Settings } from "../model";
import type { DecoderPlugin } from "./plugins";
import type { DecoderEvent } from "../types";
import type { OokBurst } from "../ook/model";
export function ookPlugin(s: Settings): DecoderPlugin {
  const native = new OokDecoder(
    s.channel - s.center,
    s.bandwidth,
    s.ook.threshold ?? -120,
    s.ook.minPulseUs,
    s.ook.gapUs,
  );
  let last = -Infinity;
  return {
    process(iq, firstSample) {
      native.process(iq);
      const events: DecoderEvent[] = (
        JSON.parse(native.take_bursts()) as OokBurst[]
      ).map((burst) => ({ type: "message", protocol: "ook", burst }));
      if (firstSample - last >= 240000) {
        events.push({
          type: "telemetry",
          protocol: "ook",
          status: JSON.parse(native.status()),
        });
        last = firstSample;
      }
      return events;
    },
    dispose: () => native.free(),
  };
}
