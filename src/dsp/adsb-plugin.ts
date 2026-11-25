import createAdsb from "../wasm-adsb/adsb";
import wasmUrl from "../wasm-adsb/adsb.wasm?url";
import { AircraftTracker } from "../adsb/tracker";
import type { AdsbDiagnostics, ModeSFrame } from "../adsb/model";
import type { Settings } from "../model";
import type { DecoderInput } from "../meteor/model";
import type { DecoderEvent } from "../types";
import type { DecoderPlugin } from "./plugins";
export async function adsbPlugin(
  s: Settings,
  input?: DecoderInput,
): Promise<DecoderPlugin> {
  if (input && (input.format !== "cu8" || input.sampleRate !== 2400000))
    throw Error("ADS-B requires CU8 at 2.4 MSPS.");
  // Fresh instance isolates upstream static phase/cache state on every retune.
  const native = await createAdsb({ locateFile: () => wasmUrl });
  if (!native._adsb_init(s.adsb.correction ? 1 : 0))
    throw Error("ADS-B initialization failed.");
  const pointer = native._malloc(131072);
  if (!pointer) throw Error("ADS-B input allocation failed.");
  const tracker = new AircraftTracker(s.adsb, (type, ref, even, odd, useOdd) =>
    JSON.parse(
      native.UTF8ToString(
        native._adsb_cpr(
          type,
          ref.lat,
          ref.lon,
          even.lat,
          even.lon,
          odd.lat,
          odd.lon,
          useOdd ? 1 : 0,
          even.surface ? 1 : 0,
        ),
      ),
    ),
  );
  let referenceTime = input?.referenceTime;
  let nextSample: number | undefined,
    lastPublished = -Infinity,
    processingMs = 0,
    lastValid = 0,
    lastTime = 0,
    now = 0;
  function ingest() {
    const frames: ModeSFrame[] = JSON.parse(
      native.UTF8ToString(native._adsb_take()),
    );
    for (const m of frames) tracker.ingest(m);
  }
  function publish(force = false): DecoderEvent[] {
    if (!force && now - lastPublished < 0.5) return [];
    const aircraft = tracker.snapshot(now),
      status: Omit<
        AdsbDiagnostics,
        | "processingMs"
        | "rate"
        | "active"
        | "positioned"
        | "positionRejected"
        | "evicted"
      > = JSON.parse(native.UTF8ToString(native._adsb_stats()));
    const stats: AdsbDiagnostics = {
      ...status,
      processingMs,
      rate: (status.valid - lastValid) / Math.max(0.001, now - lastTime),
      active: aircraft.length,
      positioned: aircraft.filter(
        (a) => a.position && now - a.position.at <= 15,
      ).length,
      positionRejected: tracker.rejected,
      evicted: tracker.evicted,
    };
    lastValid = status.valid;
    lastTime = now;
    lastPublished = now;
    return [
      {
        type: "telemetry",
        protocol: "adsb",
        batch: {
          seconds: now,
          aircraft,
          stats,
          source: input?.replay ? "replay" : "live",
          referenceTime,
        },
      },
    ];
  }
  return {
    process(iq, firstSample) {
      const start = performance.now();
      if (!referenceTime && !input?.replay)
        referenceTime = new Date(Date.now() - firstSample / 2400).toISOString();
      if (nextSample !== undefined && nextSample !== firstSample)
        tracker.resetPositions();
      for (let at = 0; at < iq.length; at += 131072) {
        const slice = iq.subarray(at, at + 131072);
        native.HEAPU8.set(slice, pointer);
        if (!native._adsb_process(pointer, slice.length, firstSample + at / 2))
          throw Error("Invalid ADS-B IQ block.");
        ingest();
      }
      nextSample = firstSample + iq.length / 2;
      now = nextSample / 2400000;
      processingMs += performance.now() - start;
      return publish();
    },
    finish() {
      native._adsb_finish();
      ingest();
      return publish(true);
    },
    dispose() {
      native._free(pointer);
    },
  };
}
