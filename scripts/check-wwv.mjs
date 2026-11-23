import assert from "node:assert/strict";
import { receiverModule } from "./wasm-receivers.mjs";
const { WwvDecoder } = await receiverModule("wwv");
import { WwvAudioFixture } from "../src/dsp/wwv-fixture.ts";

function run(corruptMarker = false) {
  const decoder = new WwvDecoder(0, 10000),
    fixture = new WwvAudioFixture();
  const count = 123 * 48000,
    block = new Float32Array(16384);
  for (let at = 0; at < count; at += block.length) {
    const length = Math.min(block.length, count - at);
    for (let i = 0; i < length; i++) {
      const t = (at + i) / 48000;
      // Replace every second-19 marker with a zero-width-code pulse. Cadence is
      // intact, so rejection must come from frame validation, not lost timing.
      const absolute = t + 58,
        fraction = absolute - Math.floor(absolute);
      const shorten =
        corruptMarker &&
        Math.floor(absolute) % 60 === 19 &&
        fraction >= 0.2 &&
        fraction < 0.8;
      block[i] =
        fixture.sample(t) -
        (shorten ? 0.5 * Math.sin(2 * Math.PI * 100 * t + 0.8) : 0);
    }
    decoder.process_audio(block.subarray(0, length));
  }
  const status = JSON.parse(decoder.status());
  decoder.free();
  return status;
}
const status = run();
assert(status.confirmed);
assert.equal(status.validFrames, 2);
assert.equal(status.rejectedFrames, 0);
assert.deepEqual(
  [
    status.frame.year,
    status.frame.dayOfYear,
    status.frame.hour,
    status.frame.minute,
  ],
  [2026, 324, 12, 35],
);
assert(Math.abs(status.frame.dut1 - 0.3) < 0.001);
const corrupt = run(true);
assert(!corrupt.confirmed);
assert.equal(corrupt.validFrames, 0);
assert(corrupt.rejectedFrames > 0);
assert.equal(corrupt.frame, null);
console.log(
  `Real WWV WASM: 100 Hz code decoded as 2026/day324 12:35 UTC, DUT1 +0.3; two consecutive minutes confirmed. Corrupted markers rejected (${corrupt.rejectedFrames} frames).`,
);
