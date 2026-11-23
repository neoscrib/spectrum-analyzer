import assert from "node:assert/strict";
import { receiverModule } from "./wasm-receivers.mjs";
const { OokDecoder } = await receiverModule("ook");
import { OokTestSignal } from "../src/dsp/ook-synthetic.ts";
import { interpretBurst, ookDefaults, burstHex } from "../src/ook/model.ts";
for (const offset of [-175000, 170000]) {
  const source = new OokTestSignal(),
    d = new OokDecoder(offset, 50000, -120, 50, 5000);
  const bursts = [];
  let dspMs = 0;
  for (let n = 0; n < 2400000 * 2.4; n += 65536) {
    const iq = source.process(433920000 - offset);
    const t = performance.now();
    d.process(iq);
    dspMs += performance.now() - t;
    bursts.push(...JSON.parse(d.take_bursts()));
  }
  assert.equal(
    bursts.length,
    3,
    "Should acquire OOK, nonzero-low ASK, then OOK",
  );
  for (const burst of bursts) {
    assert.equal(burst.durations.length, 16);
    assert(burst.durations.every((v) => Number.isFinite(v) && v > 0));
    assert.equal(
      burstHex(interpretBurst(burst, { ...ookDefaults, encoding: "pwm" })),
      "A6",
    );
    assert(burst.gapLowerBound);
  }
  const status = JSON.parse(d.status());
  assert.equal(status.sampleRate, 120000);
  assert.equal(status.trace.length, 512);
  assert(status.trace.every(Number.isFinite));
  assert.equal(status.rejected, 0);
  d.free();
  console.log("Actual OOK/ASK WASM:", {
    offset,
    bursts: bursts.length,
    hex: "A6",
    dspMsPerRfSecond: Math.round(dspMs / 2.4),
  });
}
