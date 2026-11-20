import { it, expect } from "vitest";
import { ControlQualityWindow } from "./quality";
it("reports recent decoded throughput and candidate rejection separately from old totals", () => {
  const q = new ControlQualityWindow();
  expect(q.update({ seconds: 0, valid: 0, invalid: 0 })).toEqual({
    seconds: 0,
    validPerSecond: 0,
    rejectedPercent: null,
  });
  for (let second = 1; second <= 10; second++)
    q.update({ seconds: second, valid: second * 10, invalid: second * 30 });
  let result = q.update({ seconds: 15, valid: 200, invalid: 300 });
  expect(result).toEqual({
    seconds: 5,
    validPerSecond: 20,
    rejectedPercent: 0,
  });
  result = q.update({ seconds: 1, valid: 5, invalid: 0 });
  expect(result).toEqual({
    seconds: 0,
    validPerSecond: 0,
    rejectedPercent: null,
  });
});
