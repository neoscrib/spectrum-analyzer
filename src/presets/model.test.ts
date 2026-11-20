import { it, expect } from "vitest";
import {
  captureWindows,
  starterLibrary,
  validateLibrary,
  presetSettings,
  matchesTone,
} from "./model";
import { defaults, validateSettings } from "../model";
it("has exact FRS/GMRS frequencies and covers all 22 channels in two capture windows", () => {
  const library = starterLibrary();
  validateLibrary(library);
  const frs = library.banks[0];
  expect(frs.presets.map((p) => p.frequency)).toEqual([
    462562500, 462587500, 462612500, 462637500, 462662500, 462687500, 462712500,
    467562500, 467587500, 467612500, 467637500, 467662500, 467687500, 467712500,
    462550000, 462575000, 462600000, 462625000, 462650000, 462675000, 462700000,
    462725000,
  ]);
  const windows = captureWindows(frs);
  expect(windows.map((w) => w.presets.length)).toEqual([15, 7]);
  expect(new Set(windows.flatMap((w) => w.presets.map((p) => p.id))).size).toBe(
    22,
  );
  for (const w of windows)
    for (const p of w.presets)
      expect(Math.abs(p.frequency - w.center) + p.bandwidth / 2).toBeLessThan(
        1200000 - 24000,
      );
});
it("retains a containing RF window and supports non-NFM tuning independently of monitor capability", () => {
  const p = starterLibrary().banks[0].presets[0];
  const current = { ...defaults, center: 462400000, channel: 462500000 };
  const next = presetSettings(p, current);
  expect(next.center).toBe(current.center);
  expect(next.channel).toBe(462562500);
  expect(next.bandwidth).toBe(12500);
  expect(next.decoder).toBe("nfm");
  validateSettings(next);
  const moved = presetSettings(p, defaults);
  expect(moved.center).toBe(462462500);
  expect(
    captureWindows({
      id: "mixed",
      name: "Mixed",
      presets: [{ ...p, decoder: "wfm", bandwidth: 200000 }],
    }),
  ).toHaveLength(0);
});
it("round-trips custom banks and rejects unsupported or maliciously oversized configuration", () => {
  const library = starterLibrary();
  expect(() =>
    validateLibrary(JSON.parse(JSON.stringify(library))),
  ).not.toThrow();
  const invalid = structuredClone(library);
  invalid.banks[0].presets[0].frequency = 1;
  expect(() => validateLibrary(invalid)).toThrow();
  const duplicate = structuredClone(library);
  duplicate.banks.push(duplicate.banks[0]);
  expect(() => validateLibrary(duplicate)).toThrow();
});
it("matches measured CTCSS float precision and equivalent DCS polarities", () => {
  expect(
    matchesTone(
      { type: "ctcss", hz: 162.2 },
      { ctcss: 162.199996948242, dcs: [] },
    ),
  ).toBe(true);
  expect(
    matchesTone({ type: "ctcss", hz: 162.2 }, { ctcss: 167.9, dcs: [] }),
  ).toBe(false);
  expect(
    matchesTone(
      { type: "dcs", code: "047", inverted: true },
      {
        ctcss: null,
        dcs: [
          { code: "023", inverted: false },
          { code: "047", inverted: true },
        ],
      },
    ),
  ).toBe(true);
});
