import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { Receiver, ArmerTestSource } from "../src/wasm/spectrum_dsp.js";
await init({
  module_or_path: await readFile(
    new URL("../src/wasm/spectrum_dsp_bg.wasm", import.meta.url),
  ),
});
const center = 852400000,
  control = 853075000,
  rate = 2400000;
const receiver = new Receiver(center, control, rate),
  muted = new Receiver(center, control, rate),
  source = new ArmerTestSource();
const enabled = new Uint8Array(65536).fill(1);
enabled[0] = 0;
receiver.set_enabled(enabled);
muted.set_enabled(new Uint8Array(65536));
const audioGroups = new Set(),
  events = [];
let pcmCount = 0,
  mutedGrants = 0,
  elapsed = performance.now();
for (let sample = 0; sample < rate * 9; sample += 65536) {
  const iq = source.process(center, 65536);
  receiver.process(iq);
  muted.process(iq);
  const pcm = receiver.take_audio();
  assert(pcm.every(Number.isFinite));
  if (pcm.length) {
    audioGroups.add(receiver.audio_talkgroup());
    pcmCount += pcm.length;
  }
  events.push(...JSON.parse(receiver.take_events()));
  mutedGrants += JSON.parse(muted.take_events()).filter(
    (e) => e.kind === "grant",
  ).length;
  assert.equal(
    muted.take_audio().length,
    0,
    "Muted policy must never emit PCM",
  );
}
assert(
  events.some(
    (e) =>
      e.kind === "site" && e.rfss === 5 && e.site === 75 && e.system === 0x40f,
  ),
);
assert(events.some((e) => e.kind === "network" && e.wacn === 0xbee07));
assert(events.some((e) => e.talkgroup === 6670 && e.encrypted === true));
assert(
  events.some(
    (e) => e.talkgroup === 43216 && e.message === "Outside receiver bandwidth",
  ),
);
assert.deepEqual([...audioGroups].sort(), [6620, 6640]);
assert(pcmCount > 10000);
assert(mutedGrants > 40);
const stats = JSON.parse(receiver.stats());
assert(stats.valid > 200);
assert.equal(stats.invalid, 0);
console.log("ARMER generated CU8 → actual WASM:", {
  ...stats,
  pcmCount,
  audioGroups: [...audioGroups],
  mutedGrants,
  elapsedMs: Math.round(performance.now() - elapsed),
});
receiver.free();
muted.free();
source.free();

if (process.env.ARMER_CAPTURE) {
  const iq = await readFile(process.env.ARMER_CAPTURE),
    r = new Receiver(center, control, rate);
  r.set_enabled(enabled);
  let audio = 0,
    site = false,
    network = false,
    grants = 0;
  for (let at = 0; at < iq.length; at += 131072) {
    r.process(iq.subarray(at, at + 131072));
    audio += r.take_audio().length;
    for (const e of JSON.parse(r.take_events())) {
      if (e.kind === "site" && e.site === 75 && e.system === 0x40f) site = true;
      if (e.kind === "network" && e.wacn === 0xbee07) network = true;
      if (e.kind === "grant") grants++;
    }
  }
  assert(site && network);
  assert(JSON.parse(r.stats()).valid > 0);
  console.log("Reference RF recording decoded:", {
    bytes: iq.length,
    audioSamples: audio,
    grants,
    ...JSON.parse(r.stats()),
  });
  r.free();
}
