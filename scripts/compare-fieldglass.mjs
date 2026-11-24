// Compare actual built WASM modules with identical CU8, not separate RF sessions.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { receiverModule } from "./wasm-receivers.mjs";
const { Receiver, ArmerTestSource } = await receiverModule("armer");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceDir =
  process.env.FIELDGLASS_WASM_DIR || resolve(root, "../armer/web/src/wasm");
const reference = await import(
  pathToFileURL(resolve(referenceDir, "armer_dsp.js")).href
);
await reference.default({
  module_or_path: await readFile(resolve(referenceDir, "armer_dsp_bg.wasm")),
});
const results = [];
function compare(name, center, chunks) {
  const local = new Receiver(center, 853075000, 2400000),
    original = new reference.Receiver(center, 853075000, 2400000);
  local.set_listen(new Uint16Array(), 0);
  original.set_listen(new Uint16Array(), 0);
  const localEvents = [],
    referenceEvents = [];
  for (const iq of chunks) {
    local.process(iq);
    original.process(iq);
    localEvents.push(...JSON.parse(local.take_events()));
    referenceEvents.push(...JSON.parse(original.take_events()));
    assert.equal(local.take_audio().length, 0);
    assert.equal(original.take_audio().length, 0);
  }
  const { voiceLimit, ...stats } = JSON.parse(local.stats()),
    baseline = JSON.parse(original.stats());
  assert.deepEqual(stats, baseline, `${name}: receiver counters differ`);
  assert.deepEqual(
    // Local control messages now add a readable description and BSI fields.
    // Compare every original field to Fieldglass; check enrichment separately.
    localEvents.map(({ control, ...original }) => original),
    referenceEvents,
    `${name}: decoded protocol messages differ`,
  );
  results.push({
    name,
    center,
    ...stats,
    identicalMessages: localEvents.length,
  });
  local.free();
  original.free();
  return stats;
}
function* generated(center, noise) {
  const source = new ArmerTestSource();
  let samples = 0,
    seed = 42;
  const sizes = [65536, 1240, 96000, 32769];
  let index = 0;
  while (samples < 3000000) {
    const count = Math.min(sizes[index++ % sizes.length], 3000000 - samples),
      iq = source.process(center, count);
    samples += count;
    if (noise)
      for (let n = 0; n < iq.length; n++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        iq[n] = Math.max(
          0,
          Math.min(
            255,
            Math.round(iq[n] + ((seed >>> 8) / 16777216 - 0.5) * noise),
          ),
        );
      }
    yield iq;
  }
  source.free();
}
for (const center of [852400000, 853850000])
  for (const noise of [0, 45]) {
    const stats = compare(
      `Generated ${noise ? "noisy" : "clean"} C4FM`,
      center,
      generated(center, noise),
    );
    if (!noise) {
      assert(stats.valid > 40);
      assert.equal(stats.invalid, 0);
    }
  }
if (process.env.ARMER_CAPTURE) {
  const iq = await readFile(process.env.ARMER_CAPTURE),
    center = Number(process.env.ARMER_CENTER || 852400000);
  for (const size of [131072, 4802]) {
    function* chunks() {
      for (let at = 0; at < iq.length; at += size)
        yield iq.subarray(at, at + size);
    }
    compare(`Recorded RF · ${size} byte chunks`, center, chunks());
  }
}
await mkdir(resolve(root, "artifacts"), { recursive: true });
await writeFile(
  resolve(root, "artifacts/fieldglass-parity.json"),
  JSON.stringify(results, null, 2),
);
console.log("Exact Fieldglass control-decoder parity:", results);
