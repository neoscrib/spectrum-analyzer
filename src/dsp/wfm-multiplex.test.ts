import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import initWfm from "../wasm/wfm";
import initCore from "../wasm/dsp_core";
import { wfmPlugin } from "./wfm-plugin";
import { defaults, SAMPLE_RATE } from "../model";
import type { DecoderEvent, MultiplexSpectrum } from "../types";

beforeAll(async () => {
  await initWfm({
    module_or_path: await readFile(
      new URL("../wasm/wfm_bg.wasm", import.meta.url),
    ),
  });
  await initCore({
    module_or_path: await readFile(
      new URL("../wasm/dsp_core_bg.wasm", import.meta.url),
    ),
  });
});

it("real WFM WASM preserves PCM and raw multiplex across view and mono changes", async () => {
  const reference = await wfmPlugin(defaults),
    observed = await wfmPlugin(defaults);
  let phase = 0,
    at = 0,
    latest: MultiplexSpectrum | undefined;
  const frames: MultiplexSpectrum[] = [];
  function input(count: number) {
    const iq = new Uint8Array(count * 2);
    for (let n = 0; n < count; n++) {
      const t = (at + n) / SAMPLE_RATE;
      const theta = 2 * Math.PI * 19000 * t + 0.7;
      const left = 0.4 * Math.sin(2 * Math.PI * 1000 * t);
      const right = 0.4 * Math.sin(2 * Math.PI * 2000 * t);
      const multiplex =
        (left + right) / 2 +
        ((left - right) / 2) * Math.sin(2 * theta) +
        0.09 * Math.sin(theta) +
        0.03 *
          Math.sin(2 * Math.PI * 57000 * t) *
          Math.sin(2 * Math.PI * 1200 * t);
      phase +=
        (2 *
          Math.PI *
          (defaults.channel - defaults.center + 75000 * multiplex)) /
        SAMPLE_RATE;
      iq[n * 2] = Math.round(127.5 + 80 * Math.cos(phase));
      iq[n * 2 + 1] = Math.round(127.5 + 80 * Math.sin(phase));
    }
    return iq;
  }
  function process(blocks: number, open: boolean, mono = false) {
    for (let block = 0; block < blocks; block++) {
      const iq = input(65536);
      const actual = observed.process(iq, at),
        expected = reference.process(iq, at);
      const audio = actual.find(
        (e): e is Extract<DecoderEvent, { type: "audio" }> =>
          e.type === "audio",
      )!;
      const baseline = expected.find((e) => e.type === "audio")!;
      expect(audio.samples).toEqual(baseline.samples);
      expect(audio.firstSample).toBe(at);
      expect(audio.samples.length).toBeGreaterThan(0);
      // The existing stereo blend fades smoothly rather than cutting L-R.
      if (mono && block === blocks - 1)
        expect(
          audio.samples.every(
            (value, i, samples) =>
              i % 2 === 0 || Math.abs(value - samples[i - 1]) < 0.002,
          ),
        ).toBe(true);
      const spectra = actual.filter((e) => e.type === "spectrum");
      if (!open) expect(spectra).toHaveLength(0);
      for (const event of spectra) {
        latest = event.multiplex;
        frames.push(latest);
      }
      at += iq.length / 2;
    }
  }
  function checkFrequencies(frame: MultiplexSpectrum) {
    expect(frame.sampleRate).toBe(240000);
    expect(frame.sampleRate / 2).toBeGreaterThan(65000);
    for (const hz of [19000, 55800, 58200]) {
      const expected = (hz * frame.fftSize) / frame.sampleRate;
      let best = Math.round(expected);
      for (
        let bin = Math.floor(expected) - 5;
        bin <= Math.ceil(expected) + 5;
        bin++
      )
        if (frame.bins[bin] > frame.bins[best]) best = bin;
      expect(
        Math.abs((best * frame.sampleRate) / frame.fftSize - hz),
      ).toBeLessThan(frame.sampleRate / frame.fftSize);
      expect(frame.bins[best]).toBeGreaterThan(hz === 19000 ? -25 : -42);
    }
  }
  try {
    process(5, false);
    observed.setMultiplexEnabled!(true);
    process(16, true);
    checkFrequencies(latest!);
    const beforeMono = latest!.averages;
    reference.setStereoEnabled!(false);
    observed.setStereoEnabled!(false);
    process(12, true, true);
    checkFrequencies(latest!);
    expect(latest!.averages).toBeGreaterThan(beforeMono);
    const closedAt = frames.length;
    observed.setMultiplexEnabled!(false);
    process(8, false, true);
    expect(frames).toHaveLength(closedAt);
    observed.setMultiplexEnabled!(true);
    process(8, true, true);
    checkFrequencies(latest!);
  } finally {
    observed.dispose();
    reference.dispose();
  }
});
