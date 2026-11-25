import {
  BiasEstimator,
  automaticBiasStep,
  type MeteorBiasCommand,
} from "./bias";
import type { DecoderModule } from "../wasm-meteor/meteor";
import type { Settings } from "../model";
import type { DecoderPlugin } from "../dsp/plugins";
import type { DecoderEvent } from "../types";
import {
  liveInput,
  referenceSettings,
  type DecoderInput,
  type MeteorStatus,
} from "./model";
import { validateSettings } from "./settings";
import { validateReplay } from "./replay";
import { createReplayTuning } from "./replay-tuning";
import { parseTle, tleAgeDays, dopplerHz } from "./tracking";
import { iqStride, iqValue } from "./input";

/** One fresh native instance per configuration: upstream has module-static state.
 * No independent SDR input, no intermediate float IQ allocation, no full-image copies. */
export function meteorEngine(
  s: Settings,
  native: DecoderModule,
  input: DecoderInput = liveInput,
): DecoderPlugin {
  const settings = referenceSettings(s, input);
  const problem =
    validateSettings(settings) ||
    (input.replay && validateReplay(input.replay, settings));
  if (problem) throw Error(problem);
  const replayTuning = input.replay
    ? createReplayTuning(settings, input.replay)
    : undefined;
  const orbit =
    !input.replay && settings.doppler
      ? parseTle(settings.tle, settings.satellite)
      : undefined;
  if (orbit && Math.abs(tleAgeDays(orbit)) > 14)
    throw Error(
      "Refresh Meteor orbital elements before enabling live Doppler (TLE older than 14 days).",
    );
  native._browser_init(
    input.sampleRate,
    settings.symbolRate,
    Number(settings.mode === "oqpsk"),
    Number(settings.nrzm),
    Number(settings.interleaved),
  );
  native._browser_reacquire_after(
    input.replay?.reacquireSeconds ??
      (input.replay ? 0 : s.meteor.reacquireSeconds),
  );
  const limit = input.replay
    ? input.replay.carrierLimitHz
    : settings.carrierLimitHz;
  if (limit !== undefined) native._browser_carrier_limit(limit);
  const pointer = native._malloc(65536 * 8);
  if (!pointer) throw Error("Meteor could not allocate its input buffer.");
  let samples = 0,
    lastView = -Infinity,
    lastWall = -Infinity,
    previousFrames = 0;
  let lastFrameSample: number | null = null,
    disposed = false;
  let appliedBias =
    input.replay?.frequencyOffsetHz ?? settings.frequencyBiasHz ?? 0;
  let configuredBias = appliedBias;
  const dopplerRemoved = Boolean(
    input.replay ? input.replay.historicalDoppler : orbit,
  );
  let automatic =
    dopplerRemoved &&
    (input.replay
      ? (input.replay.autoBias ?? true)
      : (s.meteor.autoBias ?? true));
  let measuring = !automatic && Boolean(input.replay?.estimateBias),
    adjustments = 0,
    estimator: BiasEstimator | undefined;
  const enableEstimator = () => {
    const enabled = automatic || measuring;
    native._browser_bias_enable(Number(enabled));
    if (enabled) {
      if (!native._browser_bias_iq())
        throw Error("Could not allocate the bias measurement tap.");
      estimator ??= new BiasEstimator(native._browser_bias_rate());
    }
  };
  enableEstimator();
  let lastOffset = 0,
    lastDoppler = 0,
    estimateStarted = 0;
  const fits = (next: number) =>
    Number.isFinite(next) &&
    Math.abs(next) <= 100000 &&
    Math.abs(s.channel - s.center + next + lastDoppler) + 80000 <=
      input.sampleRate / 2;
  let biasNotice = "";
  function changeBias(next: number, gentle: boolean) {
    if (
      !Number.isFinite(next) ||
      Math.abs(next) > 100000 ||
      Math.abs(s.channel - s.center + next + lastDoppler) + 80000 >
        input.sampleRate / 2
    )
      throw Error(
        "The adjusted LRPT signal must fit inside the capture bandwidth.",
      );
    const delta = next - appliedBias;
    if (Math.abs(delta) < 0.5) return;
    biasNotice = "";
    native._browser_bias_tune(lastOffset + delta, Number(gentle));
    lastOffset += delta;
    appliedBias = next;
    adjustments++;
    estimator?.resetWindow();
  }
  const setMeteorBias = (command: MeteorBiasCommand) => {
    switch (command.action) {
      case "estimate":
        biasNotice = "";
        measuring = command.enabled && !automatic;
        estimateStarted = samples / input.sampleRate;
        if (measuring)
          estimator = new BiasEstimator(native._browser_bias_rate());
        enableEstimator();
        break;
      case "auto":
        biasNotice = "";
        // Automatic mode replaces a one-shot request; disabling it freezes
        // tuning and stops measurement until explicitly requested again.
        measuring = false;
        automatic = command.enabled && dopplerRemoved;
        if (automatic)
          estimator = new BiasEstimator(native._browser_bias_rate());
        enableEstimator();
        break;
      case "apply":
        changeBias(
          command.biasHz,
          Math.abs(command.biasHz - appliedBias) <= 100 &&
            lastFrameSample !== null &&
            samples - lastFrameSample < input.sampleRate * 2,
        );
        configuredBias = command.biasHz;
        break;
    }
    lastView = -Infinity;
    lastWall = -Infinity;
  };
  const heights = new Array<number>(6).fill(0);
  const tails = Array.from({ length: 6 }, () => new Uint8Array(1568 * 8));
  let previousStrips = 0,
    decodeMs = 0,
    firstView = true;
  return {
    setMeteorBias,
    process(iq) {
      if (disposed) throw Error("Meteor decoder has been disposed.");
      const start = performance.now(),
        stride = iqStride(input.format);
      if (iq.byteLength % stride)
        throw Error("Incomplete I/Q pair in Meteor input.");
      const view = new DataView(iq.buffer, iq.byteOffset, iq.byteLength);
      let tune = replayTuning?.(samples);
      if (!tune) {
        const shift = orbit
          ? Math.round(
              dopplerHz(orbit, settings, Date.now(), s.channel) * 100,
            ) / 100
          : 0;
        tune = {
          offsetHz:
            s.channel - s.center + (settings.frequencyBiasHz ?? 0) + shift,
          dopplerHz: shift,
          captureTimeUtc: undefined,
        };
      }
      tune.offsetHz +=
        appliedBias -
        (input.replay?.frequencyOffsetHz ?? settings.frequencyBiasHz ?? 0);
      lastOffset = tune.offsetHz;
      lastDoppler = tune.dopplerHz;
      native._browser_tune(tune.offsetHz);
      // Feed-size bound matches the reference and keeps native FIFO/lookahead bounded.
      for (let at = 0; at < iq.byteLength / stride; at += 65536) {
        const count = Math.min(65536, iq.byteLength / stride - at);
        const heap = native.HEAPF32;
        for (let n = 0; n < count * 2; n++) {
          const value = iqValue(iq, view, at * 2 + n, input.format);
          if (!Number.isFinite(value))
            throw Error("IQ contains non-finite float samples.");
          heap[pointer / 4 + n] = value;
        }
        native._browser_feed(pointer, count);
        samples += count;
        if (estimator && (measuring || automatic)) {
          const at = native._browser_bias_iq() / 4,
            length = native._browser_bias_count() * 2;
          const updated = estimator.feed(
            native.HEAPF32.subarray(at, at + length),
            appliedBias,
            samples / input.sampleRate,
          );
          if (
            updated &&
            !automatic &&
            measuring &&
            (estimator.snapshot(samples / input.sampleRate).confidence ===
              "high" ||
              (!input.replay &&
                samples / input.sampleRate - estimateStarted >= 60))
          ) {
            if (
              estimator.snapshot(samples / input.sampleRate).confidence !==
              "high"
            )
              biasNotice =
                "Not enough reliable windows; try a stronger part of the signal.";
            measuring = false;
            native._browser_bias_enable(0);
          }
          if (updated && automatic) {
            const good =
              lastFrameSample !== null &&
              samples - lastFrameSample < input.sampleRate * 2;
            const next = automaticBiasStep(
              estimator.snapshot(samples / input.sampleRate),
              appliedBias,
              good,
            );
            if (next !== null && !fits(next))
              biasNotice =
                "Estimated correction would leave the capture; held current bias.";
            if (next !== null && fits(next)) {
              changeBias(next, good);
              lastView = -Infinity;
              lastWall = -Infinity;
              tune.offsetHz = lastOffset;
            }
          }
        }
      }
      if (iq.byteLength) decodeMs = performance.now() - start;
      const val = (id: number) => native._browser_stat(id),
        frames = val(0);
      if (frames > previousFrames) lastFrameSample = samples;
      previousFrames = frames;
      const force = iq.byteLength === 0;
      if (
        !force &&
        (samples - lastView < input.sampleRate / 5 || start - lastWall < 100)
      )
        return [];
      lastView = samples;
      lastWall = start;
      const status: MeteorStatus = {
        bias: {
          ...(estimator?.snapshot(samples / input.sampleRate) ?? {
            hz: null,
            confidence: "collecting",
            contrastDb: 0,
            spreadHz: 0,
            accepted: 0,
            windows: 0,
            ageSeconds: null,
            fresh: false,
            reason: "Start estimation to measure the signal",
          }),
          ...(biasNotice ? { reason: biasNotice } : {}),
          enabled: measuring || automatic,
          automatic,
          appliedHz: appliedBias,
          configuredHz: configuredBias,
          dopplerRemoved,
          replay: Boolean(input.replay),
          adjustments,
        },
        samples,
        sampleRate: input.sampleRate,
        frames,
        badFrames: val(1),
        packets: val(2),
        strips: val(3),
        jpegErrors: val(4),
        rs: val(5),
        viterbi: val(6),
        pll: Boolean(val(7)),
        corrected: val(8),
        carrier: native._browser_carrier(),
        lastFrameSample,
        reacquisitions: val(10),
        offsetHz: tune.offsetHz,
        dopplerHz: tune.dopplerHz,
        captureTimeUtc: tune.captureTimeUtc,
        decodeMs,
        bufferedSoftBits: val(9),
        memoryBytes: native.HEAPU8.byteLength,
      };
      const at = native._browser_constellation() / 4;
      const events: DecoderEvent[] = firstView
        ? [{ type: "reset", protocol: "meteor" }]
        : [];
      firstView = false;
      events.push({
        type: "telemetry",
        protocol: "meteor",
        status,
        constellation: native.HEAPF32.slice(at, at + 512),
      });
      if (status.strips !== previousStrips) {
        previousStrips = status.strips;
        for (let channel = 0; channel < 6; channel++) {
          const height = native._browser_height(channel);
          if (!height) continue;
          // A strip can fill the last eight rows without increasing image height.
          const startRow = Math.max(0, heights[channel] - 8),
            pointer = native._browser_pixels(channel);
          const tail = native.HEAPU8.subarray(
            pointer + Math.max(0, height - 8) * 1568,
            pointer + height * 1568,
          );
          if (
            height === heights[channel] &&
            tail.every((value, index) => value === tails[channel][index])
          )
            continue;
          const pixels = native.HEAPU8.slice(
            pointer + startRow * 1568,
            pointer + height * 1568,
          );
          tails[channel].set(tail);
          events.push({
            type: "image",
            protocol: "meteor",
            image: {
              apid: channel + 64,
              width: 1568,
              height,
              startRow,
              pixels,
            },
          });
          heights[channel] = height;
        }
      }
      return events;
    },
    dispose() {
      if (!disposed) {
        native._free(pointer);
        native._browser_close();
        disposed = true;
      }
    },
  };
}
