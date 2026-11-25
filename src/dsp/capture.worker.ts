import { decoderTransfers } from "./decoder-events";
import { liveInput, type DecoderInput } from "../meteor/model";
import { iqStride, iqValue } from "../meteor/input";
import { FFT_SIZE, validateSettings, type Settings } from "../model";
import type { WorkerIn, WorkerOut } from "../types";
import type { ArmerPolicy } from "../armer/model";
import type { NfmMonitorConfig } from "../presets/model";
import { spectrum } from "./spectrum";
import { DecoderHost } from "./decoder-host";

const host = new DecoderHost();
let settings: Settings;
let spectrumEnabled = true;
let input: DecoderInput = liveInput;
let samplesProcessed = 0;
let revision = 0;
let lastSpectrum = -Infinity;
let recordingId = 0;
let multiplexEnabled = false;
let policy: ArmerPolicy = { defaultListen: true, rules: [] };
let loading = Promise.resolve();
let configuring = Promise.resolve();
let configuration = 0;
let closed = false;
function send(message: WorkerOut, transfer: Transferable[] = []) {
  postMessage(message, transfer);
}
function configure(
  s: Settings,
  nextRevision: number,
  monitor: NfmMonitorConfig | null = null,
  reportErrors = false,
) {
  validateSettings(s);
  settings = s;
  revision = nextRevision;
  samplesProcessed = 0;
  lastSpectrum = -Infinity;
  const current = ++configuration;
  configuring = host.configure(s, policy, monitor, multiplexEnabled, input);
  // A slow first download must not back up USB/FFT/recording. During loading,
  // live buffers still flow through capture, with decoding starting when ready.
  if (reportErrors)
    void configuring.catch((error) => {
      if (!closed && current === configuration)
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
    });
  return configuring;
}
async function process(data?: ArrayBuffer) {
  const start = performance.now();
  // Transfer to the decoder and back; never clone the high-rate CU8 stream.
  if (!data) await configuring; // Test-source generation lives in the decoder.
  const result =
    data && (settings.decoder === "none" || !host.ready)
      ? { data, events: [] }
      : await host.request(
          data
            ? { type: "process", data, firstSample: samplesProcessed }
            : { type: "test", firstSample: samplesProcessed },
        );
  if (!result) throw Error("The decoder did not return its input buffer.");
  const iq = new Uint8Array(result.data);
  for (const event of result.events)
    if (event.type === "telemetry" && event.protocol === "adsb")
      event.batch.source = data ? (input.replay ? "replay" : "live") : "test";
  for (const event of result.events)
    if (event.type === "same") {
      event.batch.source = data ? (input.replay ? "replay" : "live") : "test";
      if (input.referenceTime) event.batch.referenceTime = input.referenceTime;
    }
  const count = iq.byteLength / iqStride(input.format);
  samplesProcessed += count;
  let fft: Float32Array | undefined;
  if (spectrumEnabled && count > 0 && start - lastSpectrum >= 30) {
    fft = spectrum(iq, FFT_SIZE, input.format);
    lastSpectrum = start;
  }
  let power = 0,
    clipped = 0;
  const view = new DataView(iq.buffer, iq.byteOffset, iq.byteLength);
  for (let n = 0; n < count * 2; n++) {
    const value = iqValue(iq, view, n, input.format);
    if (!Number.isFinite(value)) throw Error("IQ contains non-finite samples.");
    power += value * value;
    if (input.format === "cu8" && (iq[n] === 0 || iq[n] === 255)) clipped++;
  }
  const recording = recordingId
    ? { id: recordingId, data: result.data }
    : undefined;
  send(
    {
      type: "processed",
      recording,
      spectrum: fft,
      events: result.events,
      rms: count ? 10 * Math.log10(power / count + 1e-12) : -120,
      clipping: count ? (clipped / (count * 2)) * 100 : 0,
      elapsed: performance.now() - start,
      samples: count,
      sampleRate: input.sampleRate,
      revision,
    },
    [
      ...(recording ? [recording.data] : []),
      ...(fft ? [fft.buffer] : []),
      ...decoderTransfers(result.events),
    ],
  );
}
self.onmessage = ({ data }: MessageEvent<WorkerIn>) => {
  if (data.type === "close") {
    closed = true;
    host.dispose();
    self.close();
    return;
  }
  // Await the in-flight block before terminating its decoder. Configuration,
  // policy updates, the RF clock and recording commands remain ordered.
  loading = loading
    .then(async () => {
      switch (data.type) {
        case "init":
          spectrumEnabled = data.spectrum ?? true;
          input = data.input ?? liveInput;
          policy = data.armerPolicy ?? { defaultListen: true, rules: [] };
          multiplexEnabled = data.multiplex ?? false;
          await configure(data.settings, data.revision, data.monitor);
          send({ type: "ready" });
          break;
        case "meteor-bias":
          await host.request({ type: "meteor-bias", command: data.command });
          break;
        case "wfm-multiplex":
          multiplexEnabled = data.enabled;
          await host.request({ type: "wfm-multiplex", enabled: data.enabled });
          break;
        case "spectrum-visibility":
          spectrumEnabled = data.enabled;
          lastSpectrum = -Infinity;
          break;
        case "wfm-stereo":
          settings = { ...settings, stereo: data.enabled };
          await host.request({ type: "wfm-stereo", enabled: data.enabled });
          break;
        case "same-options":
          settings = { ...settings, same: data.options };
          await host.request(data);
          break;
        case "wfm-rds":
          settings = { ...settings, rds: data.enabled };
          await host.request({ type: "wfm-rds", enabled: data.enabled });
          break;
        case "configure":
          void configure(data.settings, data.revision, data.monitor, true);
          break;
        case "recenter":
          validateSettings(data.settings);
          if (
            settings.decoder !== "armer" ||
            data.settings.decoder !== "armer" ||
            (["channel", "bandwidth", "gain", "ppm"] as const).some(
              (key) => settings[key] !== data.settings[key],
            )
          )
            throw Error(
              "Only the ARMER capture center can change without resetting its decoder.",
            );
          await host.request({ type: "recenter", settings: data.settings });
          settings = data.settings;
          revision = data.revision;
          lastSpectrum = -Infinity;
          break;
        case "recording":
          recordingId = data.id;
          break;
        case "armer-policy":
          policy = data.policy;
          await host.request({ type: "armer-policy", policy });
          revision = data.revision;
          break;
        case "nfm-hold":
          await host.request({ type: "nfm-hold", holdId: data.id });
          revision = data.revision;
          break;
        case "iq":
          if (data.revision === revision) await process(data.data);
          break;
        case "test":
          if (data.revision === revision) await process();
          break;
      }
    })
    .catch((error) => {
      if (!closed)
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
    });
};
