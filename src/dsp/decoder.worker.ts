import init, { ArmerTestSource } from "../wasm/spectrum_dsp";
import { FFT_SIZE, validateSettings, type Settings } from "../model";
import type { WorkerIn, WorkerOut } from "../types";
import { spectrum } from "./spectrum";
import { TestSignal } from "./synthetic";
import { factories, type DecoderPlugin } from "./plugins";
import { WwvTestSignal } from "./wwv-synthetic";
import { AmTestSignal } from "./am-synthetic";
import type { ArmerPolicy } from "../armer/model";
import { nfmPlugin } from "./nfm-plugin";
import { NfmTestSignal } from "./nfm-synthetic";
import { OokTestSignal } from "./ook-synthetic";
import { Rtl433TestSignal } from "./rtl433-synthetic";
import type { NfmMonitorConfig } from "../presets/model";

let settings: Settings;
let decoder: DecoderPlugin | undefined;
let samplesProcessed = 0;
let source = new TestSignal();
let wwvSource = new WwvTestSignal();
let amSource = new AmTestSignal();
let armerSource: ArmerTestSource | undefined;
let ookSource = new OokTestSignal();
let rtl433Source = new Rtl433TestSignal();
let nfmSource = new NfmTestSignal();
let armerPolicy: ArmerPolicy = { defaultListen: true, rules: [] };
let revision = 0;
let lastSpectrum = -Infinity;
let recordingId = 0;
let loading = Promise.resolve();
function send(message: WorkerOut, transfer: Transferable[] = []) {
  postMessage(message, transfer);
}
async function configure(
  s: Settings,
  nextRevision: number,
  monitor: NfmMonitorConfig | null = null,
) {
  validateSettings(s);
  decoder?.dispose();
  decoder = undefined;
  decoder =
    s.decoder === "none"
      ? undefined
      : s.decoder === "nfm"
        ? nfmPlugin(s, monitor)
        : await factories[s.decoder](s, armerPolicy);
  samplesProcessed = 0;
  settings = s;
  revision = nextRevision;
  lastSpectrum = -Infinity;
}
function process(iq: Uint8Array) {
  const start = performance.now();
  const events = decoder?.process(iq, samplesProcessed) ?? [];
  samplesProcessed += iq.length / 2;
  let fft: Float32Array | undefined;
  if (start - lastSpectrum >= 30) {
    fft = spectrum(iq, FFT_SIZE);
    lastSpectrum = start;
  }
  let power = 0,
    clipped = 0;
  for (let i = 0; i < iq.length; i++) {
    power += ((iq[i] - 127.5) / 128) ** 2;
    if (iq[i] === 0 || iq[i] === 255) clipped++;
  }
  const recording = recordingId
    ? {
        id: recordingId,
        data:
          iq.byteOffset === 0 && iq.byteLength === iq.buffer.byteLength
            ? (iq.buffer as ArrayBuffer)
            : iq.slice().buffer,
      }
    : undefined;
  send(
    {
      type: "processed",
      recording,
      spectrum: fft,
      events,
      rms: 10 * Math.log10(power / (iq.length / 2) + 1e-12),
      clipping: (clipped / iq.length) * 100,
      elapsed: performance.now() - start,
      samples: iq.length / 2,
      revision,
    },
    [
      ...(recording ? [recording.data] : []),
      ...(fft ? [fft.buffer] : []),
      ...events.flatMap((e) => (e.type === "audio" ? [e.samples.buffer] : [])),
    ],
  );
}
self.onmessage = ({ data }: MessageEvent<WorkerIn>) => {
  // Serial promise chain includes WASM initialization; configuration cannot overtake it.
  loading = loading
    .then(async () => {
      switch (data.type) {
        case "init":
          await init();
          armerPolicy = data.armerPolicy ?? { defaultListen: true, rules: [] };
          source = new TestSignal();
          wwvSource = new WwvTestSignal();
          amSource = new AmTestSignal();
          nfmSource = new NfmTestSignal();
          ookSource = new OokTestSignal();
          rtl433Source = new Rtl433TestSignal();
          await configure(data.settings, data.revision, data.monitor);
          send({ type: "ready" });
          break;
        case "configure":
          await configure(data.settings, data.revision, data.monitor);
          break;
        case "recording":
          recordingId = data.id;
          break;
        case "nfm-hold":
          decoder?.setHold?.(data.id);
          revision = data.revision;
          break;
        case "armer-policy":
          armerPolicy = data.policy;
          decoder?.setPolicy?.(armerPolicy);
          revision = data.revision;
          break;
        case "iq":
          if (data.revision === revision) process(new Uint8Array(data.data));
          break;
        case "test":
          if (data.revision === revision)
            process(
              settings.decoder === "rtl433"
                ? rtl433Source.process(settings.center)
                : settings.decoder === "ook"
                  ? ookSource.process(settings.center)
                  : settings.decoder === "nfm"
                    ? nfmSource.process(settings.center)
                    : settings.decoder === "wwv"
                      ? wwvSource.process(settings.center)
                      : settings.decoder === "armer"
                        ? (armerSource ??= new ArmerTestSource()).process(
                            settings.center,
                            65536,
                          )
                        : settings.decoder === "am"
                          ? amSource.process(settings.center)
                          : source.process(settings.center),
            );
          break;
        case "close":
          decoder?.dispose();
          armerSource?.free();
          armerSource = undefined;
          decoder = undefined;
          self.close();
          break;
      }
    })
    .catch((e) =>
      send({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
};
