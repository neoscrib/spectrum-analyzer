import { expect, it } from "vitest";
import {
  openSync,
  readSync,
  closeSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { BiasEstimator, automaticBiasStep } from "./bias";
const rate = 240000,
  size = 65536;
function source(
  kind: "qpsk" | "oqpsk" | "noise" | "tone",
  offset: number | ((seconds: number) => number),
) {
  let phase = 0,
    seed = 1234567,
    sample = 0;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const symbols = Float32Array.from({ length: 1000000 }, () =>
    random() < 0.5 ? -0.03 : 0.03,
  );
  return () => {
    const iq = new Float32Array(size * 2);
    for (let n = 0; n < size; n++, sample++) {
      const t = (sample * 72000) / rate,
        si = Math.floor(t) * 2,
        sq = Math.max(0, Math.floor(t - (kind === "oqpsk" ? 0.5 : 0))) * 2 + 1;
      let i = symbols[si % symbols.length],
        q = symbols[sq % symbols.length];
      if (kind === "noise") {
        i = (random() + random() + random() + random() - 2) * 0.03;
        q = (random() + random() + random() + random() - 2) * 0.03;
      }
      if (kind === "tone") {
        i = 0.03;
        q = 0;
      }
      const c = Math.cos(phase),
        s = Math.sin(phase);
      iq[2 * n] = i * c - q * s;
      iq[2 * n + 1] = i * s + q * c;
      const hz = typeof offset === "number" ? offset : offset(sample / rate);
      phase += (2 * Math.PI * hz) / rate;
      if (phase > Math.PI) phase -= 2 * Math.PI;
      if (phase < -Math.PI) phase += 2 * Math.PI;
    }
    return iq;
  };
}
it.each(["qpsk", "oqpsk"] as const)(
  "estimates %s offset independently of carrier lock and accounts for an already-applied bias",
  (kind) => {
    const est = new BiasEstimator(rate),
      gen = source(kind, -607.3);
    for (let n = 0; n < 40; n++)
      est.feed(gen(), -2000, ((n + 1) * size) / rate);
    const result = est.snapshot((40 * size) / rate);
    expect(result.confidence).toBe("high");
    expect(result.hz).toBeCloseTo(-2607.3, 0);
    expect(result.accepted).toBeGreaterThanOrEqual(4);
    expect(result.fresh).toBe(true);
    expect(automaticBiasStep(result, 0, false)).toBe(-2607);
    expect(automaticBiasStep(result, -2000, true)).toBe(-2100);
    expect(automaticBiasStep({ ...result, fresh: false }, 0, false)).toBeNull();
    expect(est.snapshot(100).fresh).toBe(false);
  },
  20000,
);
it.each(["noise", "tone"] as const)(
  "does not propose bias corrections from %s",
  (kind) => {
    const est = new BiasEstimator(rate),
      gen = source(kind, 2500);
    for (let n = 0; n < 40; n++) est.feed(gen(), 0, ((n + 1) * size) / rate);
    const result = est.snapshot((40 * size) / rate);
    expect(result.confidence).not.toBe("high");
    expect(result.hz).toBeNull();
    expect(automaticBiasStep(result, 0, false)).toBeNull();
  },
  20000,
);
it.each(["qpsk", "oqpsk"] as const)(
  "continues correcting slow %s oscillator drift after acquisition, holds through a fade, and resumes",
  (kind) => {
    const est = new BiasEstimator(rate),
      bias = (seconds: number) => -2607 + 3 * seconds;
    let applied = 0;
    const gen = source(kind, (seconds) => bias(seconds) - applied),
      noise = source("noise", 0),
      corrections: { seconds: number; hz: number }[] = [];
    let lastWindows = 0,
      held = 0;
    // Forty-nine seconds of RF: acquire, drift, fade for six seconds, reacquire.
    for (let n = 0; n < 180; n++) {
      const seconds = ((n + 1) * size) / rate,
        faded = n >= 100 && n < 122;
      // Advance the modulated source through the fade so its oscillator clock
      // stays aligned with RF time when reception returns.
      const iq = gen();
      if (n === 100) held = applied;
      if (est.feed(faded ? noise() : iq, applied, seconds)) {
        const estimate = est.snapshot(seconds);
        expect(estimate.windows).toBeGreaterThan(lastWindows);
        lastWindows = estimate.windows;
        const next = automaticBiasStep(estimate, applied, seconds > 10);
        if (next !== null) {
          if (seconds > 10)
            expect(Math.abs(next - applied)).toBeLessThanOrEqual(100);
          corrections.push({ seconds, hz: next });
          applied = next;
        }
      }
      if (n === 121) {
        expect(applied).toBe(held);
        expect(est.snapshot(seconds).fresh).toBe(false);
      }
    }
    expect(corrections.length).toBeGreaterThanOrEqual(4);
    expect(
      Math.abs(corrections[0].hz - bias(corrections[0].seconds)),
    ).toBeLessThan(20);
    expect(corrections.some((c) => c.seconds > 35)).toBe(true);
    expect(Math.abs(applied - bias((180 * size) / rate))).toBeLessThan(35);
    expect(est.snapshot((180 * size) / rate).fresh).toBe(true);
    expect(lastWindows).toBeGreaterThan(18);
  },
  20000,
);
const cache = "/home/tanner/code/meteor-m/artifacts/nov20-sweep/baseband.cf32";
it.skipIf(process.env.METEOR_PRIVATE_TESTS !== "1" || !existsSync(cache))(
  "finds the real recording's -2607 Hz bias from independent spectral windows",
  () => {
    const predictions: { seconds: number; dopplerHz: number }[] = JSON.parse(
      readFileSync(
        "/home/tanner/code/meteor-m/artifacts/nov20-sweep/predictions.json",
        "utf8",
      ),
    );
    const shift = (time: number) => {
      const a = Math.min(predictions.length - 2, Math.floor(time)),
        p = predictions[a],
        q = predictions[a + 1];
      return (
        p.dopplerHz +
        ((q.dopplerHz - p.dopplerHz) * (time - p.seconds)) /
          (q.seconds - p.seconds)
      );
    };
    const est = new BiasEstimator(rate),
      fd = openSync(cache, "r"),
      bytes = Buffer.alloc(32768 * 16 * 8),
      observations = [];
    try {
      for (let time = 0; time < 478; time += 7.5) {
        const count = readSync(
            fd,
            bytes,
            0,
            bytes.length,
            Math.floor(time * rate) * 8,
          ),
          iq = new Float32Array(count / 4);
        let phase = 0;
        for (let n = 0; n < iq.length; n += 2) {
          const i = bytes.readFloatLE(n * 4),
            q = bytes.readFloatLE(n * 4 + 4),
            c = Math.cos(phase),
            s = Math.sin(phase);
          iq[n] = i * c - q * s;
          iq[n + 1] = i * s + q * c;
          phase -= (2 * Math.PI * shift(time + n / 2 / rate)) / rate;
        }
        est.resetWindow();
        est.feed(iq, 0, time + iq.length / 2 / rate);
        const r = est.snapshot(time + iq.length / 2 / rate);
        if (r.hz !== null) observations.push(r);
      }
    } finally {
      closeSync(fd);
    }
    const r = est.snapshot(480);
    console.log("Independent real bias estimation:", r);
    expect(r.accepted).toBeGreaterThan(3);
    expect(r.confidence).toBe("high");
    expect(Math.abs(r.hz! + 2607.2765)).toBeLessThan(30);
  },
  60000,
);
it("holds a previous good correction immediately when the next window becomes noise", () => {
  const est = new BiasEstimator(rate),
    modulated = source("qpsk", -2607),
    noise = source("noise", 0);
  for (let n = 0; n < 32; n++)
    est.feed(modulated(), 0, ((n + 1) * size) / rate);
  expect(est.snapshot((32 * size) / rate).confidence).toBe("high");
  for (let n = 32; n < 43; n++) est.feed(noise(), 0, ((n + 1) * size) / rate);
  const result = est.snapshot((43 * size) / rate);
  expect(result.hz).not.toBeNull();
  expect(result.fresh).toBe(false);
  expect(automaticBiasStep(result, 0, false)).toBeNull();
});
