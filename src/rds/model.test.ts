import { expect, it } from "vitest";
import { broadcastClock, ptyLabel } from "./model";
import { encodeRdsBlock } from "../dsp/rds-synthetic";

it("interprets PTY through an explicit regional standard", () => {
  expect(ptyLabel(10, "rbds")).toBe("Country (10)");
  expect(ptyLabel(10, "rds")).toBe("Pop music (10)");
  expect(ptyLabel(null, "rbds")).toBe("—");
});
it("keeps broadcast UTC and the signed half-hour offset distinct", () => {
  const mjd = Date.UTC(2026, 10, 24) / 86400000 + 40587;
  expect(
    broadcastClock({ mjd, hour: 18, minute: 30, offsetMinutes: -360 }),
  ).toBe("2026-11-24 18:30 UTC · local UTC−06:00");
  expect(broadcastClock(null)).toBeNull();
});
it("the independent test encoder agrees with transmitted CRC vector words", () => {
  expect(encodeRdsBlock(0x22e1, 0x0fc)).toBe((0x22e1 << 10) | 0b0111001100);
  expect(encodeRdsBlock(0x2583, 0x198)).toBe((0x2583 << 10) | 0b1100111110);
  expect(encodeRdsBlock(0x2065, 0x168)).toBe((0x2065 << 10) | 0b1011010011);
  expect(encodeRdsBlock(0x6920, 0x1b4)).toBe((0x6920 << 10) | 0b0110111110);
});
