import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { receiverModule } from "./wasm-receivers.mjs";
const { Receiver, ArmerTestSource } = await receiverModule("armer");
const results = [];
for (const voices of [1, 4, 8]) {
  const source = new ArmerTestSource(),
    receiver = new Receiver(852400000, 853075000, 2400000);
  source.set_voice_count(voices);
  receiver.set_voice_limit(voices);
  receiver.set_enabled(new Uint8Array(65536).fill(1));
  let elapsed = 0,
    pcmFrames = 0;
  const heard = new Set(),
    next = new Map(),
    phases = [];
  const count = Math.ceil((2400000 * 20) / 65536);
  for (let n = 0; n < count; n++) {
    const iq = source.process(852400000, 65536);
    const before = performance.now();
    receiver.process(iq);
    elapsed += performance.now() - before;
    const chunks = JSON.parse(receiver.take_audio_chunks()),
      pcm = receiver.take_audio();
    assert(pcm.every(Number.isFinite));
    for (const chunk of chunks) {
      heard.add(chunk.talkgroup);
      assert.equal(chunk.length, 1440);
      assert(chunk.offset + chunk.length <= pcm.length);
      if (next.has(chunk.id))
        assert(
          chunk.start >= next.get(chunk.id),
          "call audio cannot rewind or overlap itself",
        );
      next.set(chunk.id, chunk.start + chunk.length);
      phases.push(chunk.start % 1440);
      pcmFrames += chunk.length;
    }
    receiver.take_events();
  }
  const stats = JSON.parse(receiver.stats());
  assert.equal(stats.channels, voices);
  assert.equal(heard.size, voices);
  assert.equal(stats.invalid, 0);
  // All generated voice carriers use the same symbol clock. Receiver creation
  // at different grants must not give each call its own playback time origin.
  const phase = phases[0];
  assert(
    phases.every(
      (p) => Math.min(Math.abs(p - phase), 1440 - Math.abs(p - phase)) <= 8,
    ),
  );
  results.push({
    voices,
    rfSeconds: stats.seconds,
    decoderMs: Math.round(elapsed),
    cpuPercent: Number((elapsed / (stats.seconds * 10)).toFixed(2)),
    valid: stats.valid,
    rejected: stats.invalid,
    pcmFrames,
    groups: [...heard],
  });
  receiver.free();
  source.free();
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/armer-multi-benchmark.json",
  JSON.stringify(results, null, 2),
);
console.log("Concurrent P25 IQ → timestamped WASM audio:", results);
