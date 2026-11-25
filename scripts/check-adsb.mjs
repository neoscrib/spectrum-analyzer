import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import createAdsb from "../src/wasm-adsb/adsb.js";
import {
  KNOWN_FRAMES,
  ppmIq,
  demoFrames,
  withParity,
  frame,
} from "../src/adsb/fixtures.ts";
const wasmBinary = await readFile(
  new URL("../src/wasm-adsb/adsb.wasm", import.meta.url),
);
async function decoder(fix = 0) {
  const n = await createAdsb({ wasmBinary });
  assert(n._adsb_init(fix));
  const p = n._malloc(131072);
  return {
    n,
    p,
    take: () => JSON.parse(n.UTF8ToString(n._adsb_take())),
    stats: () => JSON.parse(n.UTF8ToString(n._adsb_stats())),
  };
}
async function recover(iq, chunks = [65536], fix = 0) {
  const d = await decoder(fix),
    out = [];
  for (let at = 0, k = 0; at < iq.length;) {
    const size = Math.min(chunks[k++ % chunks.length] * 2, iq.length - at);
    d.n.HEAPU8.set(iq.subarray(at, at + size), d.p);
    assert(d.n._adsb_process(d.p, size, at / 2));
    out.push(...d.take());
    at += size;
  }
  d.n._adsb_finish();
  out.push(...d.take());
  d.n._free(d.p);
  return { messages: out, stats: d.stats() };
}
const frames = KNOWN_FRAMES.map((hex, n) => ({
  hex,
  start: 319 + n * 1000 + 0.37,
}));
const iq = ppmIq(12000, frames);
const base = await recover(iq);
assert.deepEqual(
  base.messages.map((m) => m.hex),
  KNOWN_FRAMES,
);
for (const chunks of [[1], [17, 101, 3], [256], [997], [8192]]) {
  const r = await recover(iq, chunks);
  assert.deepEqual(
    r.messages.map((m) => [m.hex, m.seconds]),
    base.messages.map((m) => [m.hex, m.seconds]),
    `Chunk boundaries ${chunks}`,
  );
}
for (const fraction of [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
  const r = await recover(
    ppmIq(2000, [{ hex: KNOWN_FRAMES[0], start: 450 + fraction }]),
  );
  assert.equal(
    r.messages[0]?.hex,
    KNOWN_FRAMES[0],
    `Fractional timing ${fraction}`,
  );
}
for (const ppm of [-250, -100, 100, 250]) {
  const r = await recover(ppmIq(12000, frames, 0, 1.5, 1234567, ppm, 450000));
  assert.deepEqual(
    r.messages.map((m) => m.hex),
    KNOWN_FRAMES,
    `ADC clock error ${ppm} ppm`,
  );
}
const shortFrame = withParity(
  Uint8Array.from([0x5d, 0x40, 0x62, 0x1d, 0, 0, 0]),
);
const apFrame = withParity(Uint8Array.from([0x20, 0, 0, 0, 0, 0, 0]), 0x40621d);
const ntFrame = frame(
  0x123456,
  Buffer.from(KNOWN_FRAMES[0], "hex").subarray(4, 11),
  18,
  1,
);
const varied = await recover(
  ppmIq(
    8000,
    [shortFrame, apFrame, ntFrame].map((hex, n) => ({
      hex,
      start: 500 + n * 1500 + 0.37,
    })),
  ),
);
assert.deepEqual(
  varied.messages.map((m) => m.hex),
  [shortFrame, apFrame, ntFrame],
);
const badPreamble = ppmIq(2000, [{ hex: KNOWN_FRAMES[0], start: 500 }]);
badPreamble.fill(128, 1000, 1040);
assert.equal(
  (await recover(badPreamble)).messages.length,
  0,
  "Missing preamble must not decode",
);
const weak = await recover(
  ppmIq(
    12000,
    frames.map((f) => ({ ...f, amplitude: 12 })),
    0,
    3,
  ),
);
assert(weak.messages.length >= 3, "Moderate noise / weak signal recovery");
const collisionBursts = [
  { hex: KNOWN_FRAMES[0], start: 1000, amplitude: 90 },
  { hex: KNOWN_FRAMES[1], start: 1200, amplitude: 55 },
  { hex: KNOWN_FRAMES[2], start: 3000 },
];
const collision = await recover(ppmIq(5000, collisionBursts));
assert(collision.messages.length >= 1);
assert(
  collision.messages.every((m) => KNOWN_FRAMES.includes(m.hex)),
  "Overlaps must not invent frames",
);
const damaged = Buffer.from(KNOWN_FRAMES[0], "hex");
damaged[7] ^= 4;
const damagedHex = damaged.toString("hex").toUpperCase();
const bad = await recover(
  ppmIq(5000, [
    { hex: KNOWN_FRAMES[0], start: 500 },
    { hex: damagedHex, start: 2000 },
  ]),
);
assert.equal(bad.messages.length, 1, "Correction defaults off");
const repaired = await recover(
  ppmIq(5000, [
    { hex: KNOWN_FRAMES[0], start: 500 },
    { hex: damagedHex, start: 2000 },
  ]),
  [65536],
  1,
);
assert.equal(repaired.messages.length, 2);
assert.equal(repaired.messages[1].corrected, 1);
assert.equal(repaired.messages[1].original, damagedHex);
const negatives = await decoder();
let seed = 98765;
const noise = new Uint8Array(131072);
let falseFrames = 0;
for (let block = 0; block < 400; block++) {
  for (let n = 0; n < noise.length; n++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    noise[n] = 128 + ((seed >>> 0) % 41) - 20;
  }
  negatives.n.HEAPU8.set(noise, negatives.p);
  negatives.n._adsb_process(negatives.p, noise.length, block * 65536);
  falseFrames += negatives.take().length;
}
assert.equal(
  falseFrames,
  0,
  "Random receiver noise produced a false Mode S frame",
);
// A gap cannot join a preamble before the gap to message bits after it.
const gap = await decoder();
const partial = ppmIq(2000, [{ hex: KNOWN_FRAMES[0], start: 500 }]);
gap.n.HEAPU8.set(partial.subarray(0, 1200), gap.p);
gap.n._adsb_process(gap.p, 1200, 0);
gap.take();
gap.n.HEAPU8.set(partial.subarray(1200), gap.p);
gap.n._adsb_process(gap.p, partial.length - 1200, 120000);
assert.equal(gap.take().length, 0);
assert.equal(gap.stats().discontinuities, 1);
// Sustained dense traffic, same bounded native memory and no sample loss. This
// benchmarks only decoding; IQ generation is outside the timed interval.
const dense = ppmIq(
  65536,
  demoFrames().map((hex, n) => ({ hex, start: 500 + n * 1200 + 0.37 })),
);
const bench = await decoder(),
  size = bench.n.HEAPU8.byteLength;
bench.n.HEAPU8.set(dense, bench.p);
let delivered = 0;
const start = performance.now();
for (let n = 0; n < 22000; n++) {
  bench.n._adsb_process(bench.p, dense.length, n * 65536);
  delivered += bench.take().length;
}
const elapsed = performance.now() - start,
  seconds = (22000 * 65536) / 2400000;
assert.equal(bench.n.HEAPU8.byteLength, size);
assert.equal(bench.stats().samples, 22000 * 65536);
assert.equal(bench.stats().dropped, 0);
assert(delivered > 500000);
assert(elapsed < seconds * 1000, "WASM must keep pace with 2.4 MSPS");
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/adsb-fixture.cu8", dense);
const flood = await decoder();
const raw = Buffer.from(KNOWN_FRAMES[0], "hex");
flood.n.HEAPU8.set(raw, flood.p);
for (let i = 0; i < 500; i++) flood.n._adsb_frame(flood.p, raw.length, i);
assert.equal(flood.take().length, 128);
assert.equal(flood.stats().dropped, 372);
assert.equal(flood.n._adsb_process(flood.p, 131074, 0), 0);
assert.equal(flood.n._adsb_process(flood.p, 1, 0), 0);
const result = {
  knownFrames: base.messages.map((m) => m.hex),
  exactChunking: true,
  shortAndLongRf: true,
  clockPpm: [-250, -100, 100, 250],
  boundedOutputQueue: true,
  fractionalPhases: 8,
  weakRecovered: weak.messages.length,
  overlapRecovered: collision.messages.length,
  noiseSeconds: (400 * 65536) / 2400000,
  falseFrames,
  memoryBytes: size,
  streamSeconds: seconds,
  frames: delivered,
  elapsedMs: elapsed,
  msPerRfSecond: elapsed / seconds,
  megaSamplesPerSecond: (22000 * 65536) / elapsed / 1000,
};
await writeFile(
  "artifacts/adsb-validation.json",
  JSON.stringify(result, null, 2),
);
console.log("ADS-B WASM validation:", result);
