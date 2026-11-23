import assert from "node:assert/strict";
import { open, readFile, writeFile, mkdir } from "node:fs/promises";
import { receiverModule } from "./wasm-receivers.mjs";
const { IqChannelizer } = await receiverModule("dsp_core");
import create from "../src/wasm-rtl433/rtl433.js";
import { Rtl433TestSignal } from "../src/dsp/rtl433-synthetic.ts";

const messages = [];
const engine = await create({
  wasmBinary: await readFile(
    new URL("../src/wasm-rtl433/rtl433.wasm", import.meta.url),
  ),
  onDecoded: (text) => messages.push(JSON.parse(text)),
});
const pointer = engine._malloc(262144);
function feed(front, iq) {
  const pcm = front.process(iq);
  engine.HEAPU8.set(
    new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
    pointer,
  );
  assert.equal(engine._rtl_process(pointer, pcm.byteLength), 1);
}
const results = [];
for (const offset of [170000, -475000]) {
  const enabled = engine._rtl_init(-1, 433920000, 0);
  const catalog = JSON.parse(engine.UTF8ToString(engine._rtl_protocols()));
  assert.equal(catalog.length, 284);
  assert.equal(enabled, 253);
  assert.equal(catalog.find((p) => p.id === 19).disabled, 0);
  const front = new IqChannelizer(offset, offset > 0 ? 200000 : 100000),
    source = new Rtl433TestSignal();
  messages.length = 0;
  const started = performance.now();
  for (let n = 0; n < 2400000 * 3; n += 65536)
    feed(front, source.process(433920000 - offset));
  const nexus = messages.find((m) => m.model === "Nexus-TH");
  assert(nexus);
  assert.equal(nexus.id, 66);
  assert.equal(nexus.temperature_C, 21.5);
  assert.equal(nexus.humidity, 56);
  const fsk = messages.find((m) => m.model === "SimpliSafe-Gen3");
  assert(fsk);
  assert.equal(fsk.id, 0x12345678);
  assert.equal(fsk.ctr, 1);
  assert.equal(fsk.mic, "CRC");
  results.push({
    offset,
    dspMs: Math.round(performance.now() - started),
    models: messages.map((m) => m.model),
  });
  front.free();
  engine._rtl_free();
}
// A selected decoder must exclude the other protocol, with arbitrary streaming
// block sizes preserving timing and the same decoded application fields.
engine._rtl_init(19, 433920000, -25);
const front = new IqChannelizer(170000, 150000),
  source = new Rtl433TestSignal();
messages.length = 0;
for (let n = 0; n < 2400000 * 3; n += 12346)
  feed(front, source.process(433750000, 12346));
assert.deepEqual(
  messages.map((m) => m.model),
  ["Nexus-TH"],
);
front.free();
engine._rtl_free();
assert.equal(engine._rtl_init(0, 433920000, 0), 284);
engine._rtl_free();
assert.equal(engine._rtl_init(999, 433920000, 0), 0);
// Native state must be reusable without progressive heap growth on decoder changes.
for (let i = 0; i < 5; i++) {
  engine._rtl_init(-1, 433920000, 0);
  engine._rtl_free();
}
const warmHeap = engine.HEAPU8.byteLength;
for (let i = 0; i < 50; i++) {
  engine._rtl_init(-1, 433920000, 0);
  engine._rtl_free();
}
assert.equal(engine.HEAPU8.byteLength, warmHeap);
// Optional private capture regression: never copies user IQ into repository/assets.
if (process.env.RTL433_CAPTURE) {
  engine._rtl_init(-1, 433920000, 0);
  messages.length = 0;
  const front = new IqChannelizer(0, 200000),
    file = await open(process.env.RTL433_CAPTURE, "r"),
    buf = Buffer.alloc(131072);
  try {
    for (;;) {
      const { bytesRead } = await file.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      feed(front, buf.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
    front.free();
    engine._rtl_free();
  }
  const frames = messages.filter((m) => m.model === "SimpliSafe-Gen3");
  assert.equal(frames.length, 12);
  assert(frames.every((m) => m.id === 0x018842b4));
  assert.deepEqual(
    [...new Set(frames.map((m) => m.ctr))],
    [45330, 45331, 45332, 45333],
  );
  results.push({
    privateCapture: "controlled-capture-1 before battery replacement",
    crcValidFrames: frames.length,
    counters: [...new Set(frames.map((m) => m.ctr))],
  });
}
engine._free(pointer);
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/rtl433-wasm-results.json",
  JSON.stringify(results, null, 2),
);
console.log("Actual rtl_433 25.12 WASM:", results);
