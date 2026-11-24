import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import initWfm from "../wasm/wfm";
import initCore from "../wasm/dsp_core";
import { wfmPlugin } from "./wfm-plugin";
import { TestSignal } from "./synthetic";
import { defaults, SAMPLE_RATE } from "../model";
import { RDS_TEST_PI, RDS_TEST_PS, RDS_TEST_TEXT } from "./rds-synthetic";
import type { RdsStatus } from "../rds/model";

beforeAll(async () => {
  await initWfm({
    module_or_path: await readFile(
      new URL("../wasm/wfm_bg.wasm", import.meta.url),
    ),
  });
  await initCore({
    module_or_path: await readFile(
      new URL("../wasm/dsp_core_bg.wasm", import.meta.url),
    ),
  });
});

it("decodes encoded CU8 RDS through the real WFM WASM with closed spectrum and forced mono, without changing PCM", async () => {
  const decoder = await wfmPlugin(defaults);
  const reference = await wfmPlugin({ ...defaults, rds: false });
  const signal = new TestSignal();
  let at = 0,
    status: RdsStatus | undefined;
  function block(open = false) {
    const iq = signal.process(defaults.center);
    const actual = decoder.process(iq, at),
      expected = reference.process(iq, at);
    const audio = actual.find((event) => event.type === "audio")!;
    const baseline = expected.find((event) => event.type === "audio")!;
    expect(
      Buffer.from(audio.samples.buffer).equals(
        Buffer.from(baseline.samples.buffer),
      ),
    ).toBe(true);
    if (!open)
      expect(actual.some((event) => event.type === "spectrum")).toBe(false);
    for (const event of actual)
      if (event.type === "telemetry" && event.protocol === "wfm" && event.rds)
        status = event.rds;
    at += iq.length / 2;
    return actual;
  }
  try {
    while (at < SAMPLE_RATE * 3.2) {
      if (at > SAMPLE_RATE && at < SAMPLE_RATE + 65536) {
        decoder.setStereoEnabled!(false);
        reference.setStereoEnabled!(false);
      }
      block();
    }
    expect(status?.synchronized).toBe(true);
    expect(status?.pi).toBe(RDS_TEST_PI);
    expect(status?.ps).toBe(RDS_TEST_PS);
    expect(status?.radioText).toBe(RDS_TEST_TEXT);
    expect(status?.pty).toBe(10);
    expect(status?.tp).toBe(true);
    expect(status?.ta).toBe(false);
    expect(status?.clock).toMatchObject({
      hour: 18,
      minute: 30,
      offsetMinutes: -360,
    });
    const valid = status!.validGroups;
    decoder.setMultiplexEnabled!(true);
    let spectra = 0;
    for (let n = 0; n < 12; n++)
      spectra += block(true).filter(
        (event) => event.type === "spectrum",
      ).length;
    expect(spectra).toBeGreaterThan(0);
    expect(status!.validGroups).toBeGreaterThan(valid);
    expect(status!.radioText).toBe(RDS_TEST_TEXT);
    decoder.setMultiplexEnabled!(false);
    decoder.setRdsEnabled!(false);
    block();
    expect(status?.enabled).toBe(false);
    expect(status?.pi).toBeNull();
  } finally {
    decoder.dispose();
    reference.dispose();
  }
}, 30000);
