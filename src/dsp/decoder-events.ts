import type { DecoderEvent } from "../types";
/** Only owned outputs cross realms; input buffers return to capture unchanged. */
export function decoderTransfers(events: DecoderEvent[]): ArrayBuffer[] {
  return events.flatMap((e): ArrayBuffer[] =>
    e.type === "audio"
      ? [e.samples.buffer as ArrayBuffer]
      : e.type === "spectrum"
        ? [e.multiplex.bins.buffer as ArrayBuffer]
        : e.type === "image"
          ? [e.image.pixels.buffer as ArrayBuffer]
          : e.type === "telemetry" && e.protocol === "meteor"
            ? [e.constellation.buffer as ArrayBuffer]
            : [],
  );
}
