import { describe, expect, it } from "vitest";
import {
  AUTO_HALF_BAND,
  AutoCenterTiming,
  chooseArmerCenter,
} from "./auto-center";
import type { ActiveCall, ArmerPolicy } from "./model";
const policy: ArmerPolicy = { defaultListen: true, rules: [] };
const control = 853075000;
const call = (
  frequency: number,
  talkgroup = 1,
  extra: Partial<ActiveCall> = {},
): ActiveCall => ({
  frequency,
  talkgroup,
  channel: talkgroup,
  source: 42,
  encrypted: false,
  selected: false,
  inCapture: false,
  phase2: false,
  age: 0,
  ...extra,
});
describe("ARMER capture-window optimization", () => {
  it("brings reachable voices into range while retaining the fixed control frequency", () => {
    const plan = chooseArmerCenter(
      854100000,
      control,
      [call(852750000)],
      policy,
    )!;
    expect(plan).toMatchObject({ covered: 1, current: 0, groups: [1] });
    expect(Math.abs(plan.center - control)).toBeLessThanOrEqual(AUTO_HALF_BAND);
    expect(Math.abs(plan.center - 852750000)).toBeLessThanOrEqual(
      AUTO_HALF_BAND,
    );
    expect(Math.abs(plan.center - control)).toBeGreaterThanOrEqual(40000);
    expect(plan.center % 1000).toBe(0);
  });
  it("does not move for already captured or physically unreachable calls", () => {
    expect(
      chooseArmerCenter(852400000, control, [call(852750000)], policy),
    ).toBeNull();
    expect(
      chooseArmerCenter(852400000, control, [call(857256250)], policy),
    ).toBeNull();
  });
  it("allows a small beneficial move when control-channel retention constrains the window", () => {
    const plan = chooseArmerCenter(
      854223000,
      control,
      [call(855400000)],
      policy,
    )!;
    expect(plan.covered).toBe(1);
    expect(Math.abs(plan.center - 854223000)).toBeLessThan(25000);
    expect(Math.abs(plan.center - control)).toBeLessThanOrEqual(AUTO_HALF_BAND);
  });
  it("counts unique enabled groups and ignores stale, encrypted, and unsupported assignments", () => {
    const calls = [
      call(854000000),
      call(853900000),
      call(855000000, 2, { encrypted: true }),
      call(855050000, 3, { phase2: true }),
      call(855100000, 4, { age: 2 }),
      call(855150000, 5),
    ];
    const filtered: ArmerPolicy = {
      defaultListen: true,
      rules: [
        { id: 5, name: "Muted", group: "", listen: false, origin: "manual" },
      ],
    };
    expect(
      chooseArmerCenter(852400000, control, calls, filtered),
    ).toMatchObject({ covered: 1, groups: [1] });
  });
  it("protects a currently playing call even when another cluster has more groups", () => {
    const calls = [call(852750000), call(855200000, 2), call(855300000, 3)];
    expect(chooseArmerCenter(852400000, control, calls, policy)?.covered).toBe(
      2,
    );
    expect(
      chooseArmerCenter(852400000, control, calls, policy, 852750000),
    ).toBeNull();
  });
  it("retains all protected voice frequencies, not just the most recent talkgroup", () => {
    const calls = [call(852750000), call(854900000, 2), call(855200000, 3)];
    const protectedPlan = chooseArmerCenter(
      853700000,
      control,
      calls,
      policy,
      [852750000, 854900000],
    );
    expect(protectedPlan?.covered).toBe(2);
    for (const hz of [control, 852750000, 854900000])
      expect(Math.abs(protectedPlan!.center - hz)).toBeLessThanOrEqual(
        AUTO_HALF_BAND,
      );
    expect(
      chooseArmerCenter(
        853700000,
        control,
        calls,
        policy,
        [852750000, 855200000],
      ),
    ).toBeNull();
    const plan = chooseArmerCenter(
      854100000,
      control,
      [call(852750000), call(853900000, 2)],
      policy,
      [853900000],
    );
    expect(plan).not.toBeNull();
    for (const hz of [control, 852750000, 853900000])
      expect(Math.abs(plan!.center - hz)).toBeLessThanOrEqual(AUTO_HALF_BAND);
  });
  it("matches a grid-search optimum for competing channel clusters", () => {
    let seed = 73;
    for (let trial = 0; trial < 20; trial++) {
      const calls = Array.from({ length: 8 }, (_, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return call(850000000 + (seed % 7000) * 1000, i + 1);
      });
      const current = new Set(
        calls
          .filter((c) => Math.abs(c.frequency - 852400000) < 1176000)
          .map((c) => c.talkgroup),
      ).size;
      let optimum = current;
      for (
        let center = Math.ceil((control - AUTO_HALF_BAND) / 1000) * 1000;
        center <= control + AUTO_HALF_BAND;
        center += 1000
      )
        optimum = Math.max(
          optimum,
          new Set(
            calls
              .filter((c) => Math.abs(c.frequency - center) <= AUTO_HALF_BAND)
              .map((c) => c.talkgroup),
          ).size,
        );
      const plan = chooseArmerCenter(852400000, control, calls, policy);
      expect(plan?.covered ?? current).toBe(optimum);
    }
  });
});
it("debounces improvements, enforces cooldown and honors a manual hold", () => {
  const timing = new AutoCenterTiming(),
    plan = { center: 853900000, covered: 2, current: 1, groups: [1, 2] };
  expect(timing.observe(plan, 0)).toBeNull();
  expect(timing.observe(plan, 799)).toBeNull();
  expect(timing.observe(plan, 800)).toBe(plan.center);
  expect(timing.observe(plan, 1000)).toBeNull();
  timing.defer(2000);
  expect(timing.observe(plan, 6999)).toBeNull();
  expect(timing.observe(plan, 7000)).toBeNull();
  expect(timing.observe(plan, 7800)).toBe(plan.center);
  timing.reset();
  expect(timing.observe(plan, 8000)).toBeNull();
  timing.observe(null, 8500);
  expect(timing.observe(plan, 9000)).toBeNull();
});
