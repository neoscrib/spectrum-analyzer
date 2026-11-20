import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

function player(rate: number) {
  let Class: any;
  class AudioWorkletProcessor {
    port = { onmessage: (_event: any) => {} };
  }
  const context = vm.createContext({
    AudioWorkletProcessor,
    Float32Array,
    Math,
    sampleRate: rate,
    registerProcessor: (_name: string, type: any) => {
      Class = type;
    },
  });
  vm.runInContext(readFileSync("public/audio-worklet.js", "utf8"), context);
  return new Class();
}

it("resamples independent stereo tones to 44.1 kHz without swapping or mixing channels", () => {
  const p = player(44100);
  const input = Float32Array.from({ length: 19200 }, (_, n) =>
    Math.sin((2 * Math.PI * (n % 2 ? 2000 : 1000) * Math.floor(n / 2)) / 48000),
  );
  p.port.onmessage({ data: input });
  const output = new Float32Array(4410);
  const right = new Float32Array(4410);
  p.process([], [[output, right]]);
  let re = 0,
    im = 0;
  for (let n = 0; n < output.length; n++) {
    re += output[n] * Math.cos((2 * Math.PI * 1000 * n) / 44100);
    im += output[n] * Math.sin((2 * Math.PI * 1000 * n) / 44100);
  }
  expect((2 * Math.hypot(re, im)) / output.length).toBeGreaterThan(0.99);
  expect(p.count).toBeCloseTo(4800, -1);
  let rightRe = 0,
    rightIm = 0,
    leakRe = 0,
    leakIm = 0;
  for (let n = 0; n < right.length; n++) {
    rightRe += right[n] * Math.cos((2 * Math.PI * 2000 * n) / 44100);
    rightIm += right[n] * Math.sin((2 * Math.PI * 2000 * n) / 44100);
    leakRe += right[n] * Math.cos((2 * Math.PI * 1000 * n) / 44100);
    leakIm += right[n] * Math.sin((2 * Math.PI * 1000 * n) / 44100);
  }
  expect((2 * Math.hypot(rightRe, rightIm)) / right.length).toBeGreaterThan(
    0.99,
  );
  expect((2 * Math.hypot(leakRe, leakIm)) / right.length).toBeLessThan(0.001);
});

it("clears buffered audio and bounds latency after a background-tab backlog", () => {
  const p = player(48000);
  p.port.onmessage({ data: new Float32Array(20000).fill(0.5) });
  p.port.onmessage({ data: new Float32Array(8000).fill(0.25) });
  expect(p.count).toBe(4000);
  p.port.onmessage({ data: "clear" });
  expect(p.count).toBe(0);
  const output = new Float32Array(128).fill(1);
  const right = new Float32Array(128).fill(1);
  p.process([], [[output, right]]);
  expect(output.every((v) => v === 0)).toBe(true);
  expect(right.every((v) => v === 0)).toBe(true);
});
