import { expect, it } from "vitest";
import {
  MultiplexAnalyzer,
  MULTIPLEX_AVERAGE_SECONDS,
} from "./multiplex-spectrum";

function tone(rate: number, count: number, hz: number, amplitude = 1) {
  return Float32Array.from(
    { length: count },
    (_, n) => amplitude * Math.sin((2 * Math.PI * hz * n) / rate),
  );
}

function peak(analyzer: MultiplexAnalyzer, frequency: number) {
  const { bins, sampleRate, fftSize } = analyzer.snapshot();
  let best = Math.round((frequency * fftSize) / sampleRate);
  for (let bin = best - 8; bin <= best + 8; bin++)
    if (bins[bin] > bins[best]) best = bin;
  return (best * sampleRate) / fftSize;
}

it("labels pilot and 57 kHz energy using the actual sample rate, independent of PCM rate", () => {
  for (const rate of [240000, 192000]) {
    const analyzer = new MultiplexAnalyzer(rate);
    const pilot = tone(rate, 32768, 19000, 0.09);
    const data = tone(rate, 32768, 57000, 0.025);
    analyzer.push(pilot.map((sample, n) => sample + data[n]));
    expect(Math.abs(peak(analyzer, 19000) - 19000)).toBeLessThan(rate / 4096);
    expect(Math.abs(peak(analyzer, 57000) - 57000)).toBeLessThan(rate / 4096);
    expect(analyzer.snapshot().sampleRate).toBe(rate);
    expect(analyzer.snapshot().bins.length).toBe(
      Math.ceil((65000 * 4096) / rate) + 1,
    );
  }
  expect(() => new MultiplexAnalyzer(48000)).toThrow("cover 65 kHz");
});

it("averages linear power rather than dB and uses a source-time averaging constant", () => {
  const rate = 240000,
    size = 4096,
    bin = 64;
  const analyzer = new MultiplexAnalyzer(rate, size);
  analyzer.push(tone(rate, size, (bin * rate) / size, 0.1));
  const before = analyzer.snapshot().bins[bin];
  expect(before).toBeCloseTo(-20, 3);
  analyzer.push(new Float32Array(size));
  const after = analyzer.snapshot().bins[bin];
  const expected =
    10 * Math.log10(Math.exp(-size / (rate * MULTIPLEX_AVERAGE_SECONDS)));
  expect(after - before).toBeCloseTo(expected, 4);
});

it("preserves FFT windows across arbitrary input block boundaries and owns its snapshots", () => {
  const signal = tone(240000, 50000, 57000, 0.03);
  const whole = new MultiplexAnalyzer(240000),
    stream = new MultiplexAnalyzer(240000);
  whole.push(signal);
  for (let at = 0; at < signal.length; at += 1234)
    stream.push(signal.subarray(at, at + 1234));
  expect(stream.snapshot()).toEqual(whole.snapshot());
  const snapshot = stream.snapshot();
  snapshot.bins.fill(123);
  expect(stream.snapshot().bins[0]).not.toBe(123);
});
