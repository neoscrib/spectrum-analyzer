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

function call(
  p: any,
  id: number,
  start: number,
  frames: number,
  hz: number,
  level = 0.2,
) {
  const samples = Float32Array.from(
    { length: frames * 2 },
    (_, n) =>
      level *
      Math.sin((2 * Math.PI * hz * (start + Math.floor(n / 2))) / 48000),
  );
  p.port.onmessage({
    data: {
      type: "armer-audio",
      id,
      talkgroup: id,
      startFrame: start,
      samples,
    },
  });
}
function render(p: any, frames: number) {
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  p.process([], [[left, right]]);
  return [left, right];
}
function amplitude(samples: Float32Array, hz: number, rate = 48000) {
  let re = 0,
    im = 0;
  for (let n = 0; n < samples.length; n++) {
    re += samples[n] * Math.cos((2 * Math.PI * hz * n) / rate);
    im += samples[n] * Math.sin((2 * Math.PI * hz * n) / rate);
  }
  return (2 * Math.hypot(re, im)) / samples.length;
}
it.each([48000, 44100])(
  "mixes overlapping calls on the same timeline at %i Hz and ends each independently",
  (rate) => {
    const p = player(rate);
    call(p, 1, 0, 4800, 1000);
    call(p, 2, 0, 9600, 2000);
    render(p, Math.round(rate * 0.06)); // shared prebuffer
    const [both] = render(p, Math.round(rate * 0.1));
    expect(amplitude(both, 1000, rate)).toBeCloseTo(0.2, 2);
    expect(amplitude(both, 2000, rate)).toBeCloseTo(0.2, 2);
    const [second] = render(p, Math.round(rate * 0.1));
    expect(amplitude(second, 1000, rate)).toBeLessThan(0.001);
    expect(amplitude(second, 2000, rate)).toBeCloseTo(0.2, 2);
    expect(render(p, 512)[0].every((v) => Math.abs(v) < 0.001)).toBe(true);
  },
);
it("keeps a missing audio interval silent instead of concatenating the next LDU", () => {
  const p = player(48000);
  call(p, 1, 0, 4800, 1000);
  render(p, 2880 + 4800);
  call(p, 1, 9600, 4800, 1000);
  expect(render(p, 4800)[0].every((v) => v === 0)).toBe(true);
  expect(amplitude(render(p, 4800)[0], 1000)).toBeCloseTo(0.2, 2);
});
it("applies live mute, solo, gain, pan and listen policy without replaying buffered calls", () => {
  const p = player(48000);
  call(p, 1, 0, 8640, 1000);
  call(p, 2, 0, 8640, 2000);
  const mix = { muted: [], solo: 1, gains: { 1: 0.5 }, pans: { 1: -1 } };
  p.port.onmessage({ data: { type: "armer-mix", mix } });
  render(p, 2880 + 480);
  const [l, r] = render(p, 2400);
  expect(amplitude(l, 1000)).toBeCloseTo(0.1, 2);
  expect(amplitude(l, 2000)).toBeLessThan(0.001);
  expect(r.every((v) => v === 0)).toBe(true);
  const before = p.mixer.position();
  p.port.onmessage({
    data: {
      type: "armer-mix",
      mix: { muted: [1], solo: null, gains: {}, pans: { 2: 1 } },
    },
  });
  render(p, 2400);
  call(p, 1, 8640, 8640, 1000);
  call(p, 2, 8640, 8640, 2000);
  const [muted, audible] = render(p, 2400);
  expect(amplitude(muted, 1000)).toBeLessThan(0.001);
  expect(amplitude(audible, 2000)).toBeCloseTo(0.2, 2);
  expect(p.mixer.position()).toBe(before + 4800);
  const enabled = new Uint8Array(65536);
  p.port.onmessage({ data: { type: "armer-policy", enabled } });
  render(p, 2400);
  expect(amplitude(render(p, 2400)[1], 2000)).toBeLessThan(0.001);
});
it("limits summed peaks, bounds stream memory and discards accumulated latency", () => {
  const p = player(48000);
  for (let id = 1; id <= 8; id++) call(p, id, 0, 9600, 1000, 0.9);
  const [l, r] = render(p, 10000);
  expect(Math.max(...l.map(Math.abs), ...r.map(Math.abs))).toBeLessThanOrEqual(
    0.950001,
  );
  // Simulate a producer backlog: newer sample times replace excessive latency.
  for (let n = 1; n < 20; n++) call(p, n, n * 8640, 8640, 1000);
  expect(
    Math.max(...[...p.mixer.streams.values()].map((s: any) => s.end)) -
      p.mixer.position(),
  ).toBeLessThanOrEqual(14400);
  expect(p.mixer.streams.size).toBeLessThanOrEqual(16);
  p.port.onmessage({ data: "clear" });
  expect(p.mixer.streams.size).toBe(0);
  expect(render(p, 128)[0].every((v) => v === 0)).toBe(true);
});
it("runs four concurrent streams for thirty seconds without growing playback latency", () => {
  const p = player(48000);
  const packets = 167; // 30.06 RF seconds, including the shared prebuffer.
  for (let n = 0; n < packets; n++) {
    for (let id = 1; id <= 4; id++) call(p, id, n * 8640, 8640, id * 1000, 0.1);
    expect(
      Math.max(...[...p.mixer.streams.values()].map((s: any) => s.end)) -
        p.mixer.position(),
    ).toBe(11520);
    for (let frame = 0; frame < 8640; frame += 128)
      render(p, Math.min(128, 8640 - frame));
  }
  expect(p.mixer.position()).toBe(packets * 8640 - 2880);
  expect(p.mixer.streams.size).toBe(4);
});
