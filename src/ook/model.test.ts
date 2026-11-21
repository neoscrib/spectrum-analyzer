import { expect, it } from "vitest";
import {
  burstHex,
  interpretBurst,
  ookDefaults,
  ookText,
  validateOok,
  type OokCapture,
} from "./model";
const capture: OokCapture = {
  id: 1,
  frequency: 433920000,
  bandwidth: 50000,
  test: true,
  receivedAt: "2026-11-20T12:00:00Z",
  options: ookDefaults,
  startSeconds: 0.1,
  endSeconds: 0.11,
  gapLowerBound: true,
  durations: [
    1000, 500, 500, 500, 1000, 500, 500, 500, 500, 500, 1000, 500, 1000, 500,
    500, 5000,
  ],
};
it("interprets explicitly configured PWM and leaves invalid timings unknown", () => {
  expect(interpretBurst(capture, ookDefaults)).toBeNull();
  const options = { ...ookDefaults, encoding: "pwm" as const };
  const bits = interpretBurst(capture, options);
  expect(bits).toBe("10100110");
  expect(burstHex(bits)).toBe("A6");
  expect(interpretBurst(capture, { ...options, invert: true })).toBe(
    "01011001",
  );
  expect(
    interpretBurst({ ...capture, durations: [660, 500, 500, 5000] }, options),
  ).toBe("?0");
  expect(burstHex("1?000000")).toBeNull();
  expect(burstHex("101")).toBeNull();
});
it("excludes the delimiter from PPM and NRZ rather than inventing trailing bits", () => {
  expect(
    interpretBurst(
      { ...capture, durations: [500, 500, 500, 1000, 500, 5000] },
      { ...ookDefaults, encoding: "ppm" },
    ),
  ).toBe("01");
  expect(
    interpretBurst(
      { ...capture, durations: [1000, 500, 500, 1000, 1000, 5000] },
      { ...ookDefaults, encoding: "nrz" },
    ),
  ).toBe("11010011");
  expect(
    interpretBurst(
      { ...capture, durations: [2000, 1000, 2000, 5000] },
      { ...ookDefaults, encoding: "nrz", shortUs: 2000 },
    ),
  ).toBe("1?1");
});
it("exports the original pulse/gap data and generated provenance without reinterpretation", () => {
  const text = ookText(capture);
  expect(text).toContain(";pulse data\n;version 1\n;timescale 1us");
  expect(text).toContain(";ook 8 pulses");
  expect(text).toContain(";freq1 433920000");
  expect(text).toContain("; Generated test: yes");
  expect(text).toContain("500 5000\n;end\n");
  expect(text.split("\n").filter((line) => /^\d/.test(line))).toHaveLength(8);
});
it("rejects settings that would lose framing or create unbounded timing expansions", () => {
  expect(() => validateOok(ookDefaults)).not.toThrow();
  for (const change of [
    { threshold: NaN },
    { threshold: -100 },
    { minPulseUs: 0 },
    { gapUs: 99 },
    { minPulseUs: 5000, gapUs: 5000 },
    { shortUs: 0 },
    { longUs: 250 },
    { encoding: "fsk" },
  ])
    expect(() =>
      validateOok({ ...ookDefaults, ...change } as typeof ookDefaults),
    ).toThrow();
  expect(() =>
    validateOok({ ...ookDefaults, encoding: "nrz", shortUs: 2000 }),
  ).not.toThrow();
});
