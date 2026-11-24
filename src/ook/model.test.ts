import { expect, it } from "vitest";
import {
  burstHex,
  formatOokDump,
  interpretBurst,
  interpretBurstWithTiming,
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
it("formats byte-aligned and partial OOK bitstreams without inventing padding", () => {
  expect(formatOokDump(null)).toBeNull();
  expect(formatOokDump("0000000010100110")).toMatchObject({
    binary: "00000000 10100110",
    hex: "00 A6",
    bitCount: 16,
    partialByteBits: 0,
  });
  expect(formatOokDump("101001101011")).toMatchObject({
    binary: "10100110 1011",
    hex: "A6 B",
    bitCount: 12,
    partialByteBits: 4,
    trailingBits: "",
  });
  expect(formatOokDump("10100110101")).toMatchObject({
    hex: "A6 [101]",
    bitCount: 11,
    partialByteBits: 3,
    trailingBits: "101",
  });
  expect(formatOokDump("101011")).toMatchObject({
    hex: "A[11]",
    bitCount: 6,
    trailingBits: "11",
  });
  expect(formatOokDump("1")).toMatchObject({ hex: "[1]", bitCount: 1 });
});
it("preserves unknown bit positions, line boundaries, and explicit truncation", () => {
  const dump = formatOokDump("0000000010100110101010101111000010?0011?1");
  expect(dump?.binary).toBe("00000000 10100110 10101010 11110000\n10?0011? 1");
  expect(dump?.hex).toBe("00 A6 AA F0\n?? [1]");
  expect(dump?.unknownBits).toBe(2);
  expect(formatOokDump("1010?110")).toMatchObject({
    hex: "A?",
    unknownBits: 1,
  });
  expect(formatOokDump("10100110…")).toMatchObject({
    binary: "10100110\n…",
    hex: "A6\n…",
    bitCount: 8,
    truncated: true,
  });
  expect(formatOokDump("")).toMatchObject({ binary: "", hex: "", bitCount: 0 });
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

it("maps 33 PWM bits to their real high/gap edges and preserves a final high without a gap", () => {
  const expected = "10010010".repeat(4) + "0";
  const durations = expected
    .split("")
    .flatMap((bit, i) => (i === 32 ? [280] : [bit === "1" ? 840 : 280, 740]));
  const data = interpretBurstWithTiming(
    { ...capture, durations, gapLowerBound: false },
    { ...ookDefaults, encoding: "pwm", shortUs: 280, longUs: 840 },
  );
  expect(data.bits).toBe(expected);
  expect(data.spans).toHaveLength(33);
  expect(data.spans[1]).toEqual({
    index: 1,
    value: "0",
    startUs: 1580,
    endUs: 2600,
  });
  expect(data.intervals[2]).toMatchObject({
    high: true,
    durationUs: 280,
    startUs: 1580,
    endUs: 1860,
  });
  expect(data.intervals[3]).toMatchObject({
    high: false,
    durationUs: 740,
    startUs: 1860,
    endUs: 2600,
  });
  expect(data.spans[32]).toEqual({
    index: 32,
    value: "0",
    startUs: 39360,
    endUs: 39640,
  });
  expect(data.signalEndUs).toBe(39640);
  expect(
    data.spans
      .filter((span) => (span.index + 1) % 8 === 0)
      .map((span) => span.endUs),
  ).toEqual([9840, 19680, 29520, 39360]);
  expect(formatOokDump(data.bits)?.groups.at(-1)).toEqual({
    startBit: 32,
    endBit: 33,
    binary: "0",
    hex: "[0]",
  });
  expect(ookText({ ...capture, durations })).toContain(";ook 33 pulses");
  expect(ookText({ ...capture, durations })).toContain("280 0\n;end");
});

it("keeps raw pulse/gap measurements for unknown decisions, independently of inversion", () => {
  const burst = {
    ...capture,
    durations: [280, 740, 500, 740, 840],
    gapLowerBound: false,
  };
  const options = {
    ...ookDefaults,
    encoding: "pwm" as const,
    shortUs: 280,
    longUs: 840,
  };
  const data = interpretBurstWithTiming(burst, options);
  expect(data.bits).toBe("0?1");
  expect(data.spans[1]).toEqual({
    index: 1,
    value: "?",
    startUs: 1020,
    endUs: 2260,
  });
  expect(data.intervals[2].durationUs).toBe(500);
  expect(
    interpretBurstWithTiming(burst, { ...options, invert: true }).spans,
  ).toEqual(
    data.spans.map((span) => ({
      ...span,
      value: span.value === "?" ? "?" : span.value === "0" ? "1" : "0",
    })),
  );
  const raw = interpretBurstWithTiming(burst, { ...options, encoding: "raw" });
  expect(raw.bits).toBeNull();
  expect(raw.spans).toEqual([]);
  expect(raw.intervals).toEqual(data.intervals);
});

it("maps PPM and NRZ to measured edges, excludes only actual delimiters, and bounds expansion", () => {
  const ppm = interpretBurstWithTiming(
    { ...capture, durations: [100, 280, 100, 840, 100, 5000] },
    { ...ookDefaults, encoding: "ppm", shortUs: 280, longUs: 840 },
  );
  expect(ppm.bits).toBe("01");
  expect(ppm.spans.map((span) => [span.startUs, span.endUs])).toEqual([
    [0, 380],
    [380, 1320],
  ]);
  expect(ppm.intervals.at(-1)?.delimiter).toBe(true);
  expect(ppm.signalEndUs).toBe(1420);
  const nrz = interpretBurstWithTiming(
    { ...capture, durations: [1050, 500, 550], gapLowerBound: false },
    { ...ookDefaults, encoding: "nrz", shortUs: 500 },
  );
  expect(nrz.bits).toBe("1101");
  expect(nrz.spans.map((span) => [span.startUs, span.endUs])).toEqual([
    [0, 525],
    [525, 1050],
    [1050, 1550],
    [1550, 2100],
  ]);
  const capped = interpretBurstWithTiming(
    { ...capture, durations: Array(34).fill(6400), gapLowerBound: false },
    { ...ookDefaults, encoding: "nrz", shortUs: 25, invert: true },
  );
  expect(capped.truncated).toBe(true);
  expect(capped.spans).toHaveLength(8192);
  expect(capped.bits).toHaveLength(8193);
  expect(capped.bits?.[0]).toBe("0");
  expect(capped.spans.at(-1)?.endUs).toBe(204800);
});
