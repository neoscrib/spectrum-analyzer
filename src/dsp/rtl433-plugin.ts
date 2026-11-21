import { IqChannelizer } from "../wasm/spectrum_dsp";
import createRtl433, { type Rtl433Module } from "../wasm-rtl433/rtl433";
import wasmUrl from "../wasm-rtl433/rtl433.wasm?url";
import type { Settings } from "../model";
import type { DecoderEvent } from "../types";
import type { Rtl433Status } from "../rtl433/model";
import type { DecoderPlugin } from "./plugins";

// One engine per worker; configurations are serialized by decoder.worker.ts.
let engine: Promise<Rtl433Module> | undefined;
export async function rtl433Plugin(s: Settings): Promise<DecoderPlugin> {
  const native = await (engine ??= createRtl433({
    locateFile: () => wasmUrl,
  }).catch((e) => {
    engine = undefined;
    throw e;
  }));
  const selection =
    s.rtl433.mode === "default"
      ? -1
      : s.rtl433.mode === "all"
        ? 0
        : s.rtl433.protocol;
  if (!native._rtl_init(selection, s.channel, s.rtl433.level ?? 0))
    throw Error("rtl_433 could not enable the selected protocol.");
  const front = new IqChannelizer(s.channel - s.center, s.bandwidth);
  const pointer = native._malloc(262144);
  if (!pointer) {
    front.free();
    native._rtl_free();
    throw Error("rtl_433 could not allocate its input buffer.");
  }
  let pending: DecoderEvent[] = [],
    lastStatus = -Infinity,
    firstStatus = true,
    dropped = 0;
  const protocols = JSON.parse(native.UTF8ToString(native._rtl_protocols()));
  native.onDecoded = (json) => {
    if (pending.length >= 64) {
      dropped++;
      return;
    }
    pending.push({
      type: "message",
      protocol: "rtl433",
      data: JSON.parse(json),
    });
  };
  return {
    process(iq, firstSample) {
      // Bounded slices match the upstream scratch buffers. Source IQ stays intact
      // for spectrum/recording; neither emitted JSON nor CS16 aliases WASM memory.
      for (let at = 0; at < iq.length; at += 131072) {
        const cs16 = front.process(iq.subarray(at, at + 131072));
        if (!cs16.length) continue;
        native.HEAPU8.set(
          new Uint8Array(cs16.buffer, cs16.byteOffset, cs16.byteLength),
          pointer,
        );
        if (!native._rtl_process(pointer, cs16.byteLength))
          throw Error("rtl_433 rejected an IQ block.");
      }
      const events = pending;
      pending = [];
      if (firstSample - lastStatus >= 480000) {
        const status: Rtl433Status = {
          ...JSON.parse(native.UTF8ToString(native._rtl_stats())),
          dropped,
          ...(firstStatus ? { protocols } : {}),
        };
        events.push({ type: "telemetry", protocol: "rtl433", status });
        lastStatus = firstSample;
        firstStatus = false;
      }
      return events;
    },
    dispose() {
      native.onDecoded = undefined;
      pending = [];
      front.free();
      native._free(pointer);
      native._rtl_free();
    },
  };
}
