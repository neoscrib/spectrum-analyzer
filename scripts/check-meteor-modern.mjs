// Engineering test: re-encode real payloads as synthetic M2-x transport.
// This does NOT claim a real modern satellite capture was received.
import fs from "node:fs";
import assert from "node:assert/strict";
import create from "../src/wasm-meteor/meteor.js";
const wasmBinary = fs.readFileSync(
  new URL("../src/wasm-meteor/meteor.wasm", import.meta.url),
);
const make = () => create({ wasmBinary });
const wav = fs.readFileSync("fixtures/meteor_m2_72k.wav");
let p = 12;
while (wav.toString("ascii", p, p + 4) !== "data")
  p += 8 + wav.readUInt32LE(p + 4);
const data = wav.subarray(p + 8);
const m = await make();
m._browser_init(187500, 72000, 0, 0, 0);
const ptr = m._malloc(65536 * 8),
  cadus = [];
let previous = 0;
for (let k = 0; k < data.length && cadus.length < 100; k += 4096 * 4) {
  const count = Math.min(4096, (data.length - k) / 4),
    out = new Float32Array(count * 2);
  for (let n = 0; n < out.length; n++)
    out[n] = data.readInt16LE(k + n * 2) / 32768;
  m.HEAPF32.set(out, ptr / 4);
  m._browser_feed(ptr, count);
  if (m._browser_stat(0) > previous) {
    previous = m._browser_stat(0);
    const at = m._browser_last_cadu();
    cadus.push(m.HEAPU8.slice(at, at + 1024));
  }
}
assert.equal(cadus.length, 100);
let reg = 255;
const noise = [];
for (let i = 0; i < 255; i++) {
  let value = 0;
  for (let b = 0; b < 8; b++) {
    value = (value << 1) | (reg & 1);
    reg =
      (reg >> 1) | ((((reg >> 7) ^ (reg >> 5) ^ (reg >> 3) ^ reg) & 1) << 7);
  }
  noise.push(value);
}
function encode(nrzm) {
  let state = 0,
    prev = 0;
  const soft = new Int8Array(cadus.length * 16384);
  const parity = (n) => {
    n ^= n >> 4;
    n ^= n >> 2;
    n ^= n >> 1;
    return n & 1;
  };
  let at = 0;
  for (const cadu of cadus) {
    const raw = cadu.slice();
    for (let n = 4; n < 1024; n++) raw[n] ^= noise[(n - 4) % 255];
    for (const byte of raw)
      for (let b = 7; b >= 0; b--) {
        let bit = (byte >> b) & 1;
        if (nrzm) {
          prev ^= bit;
          bit = prev;
        }
        state = (state >> 1) | (bit << 6);
        soft[at++] = parity(state & 0x5b) ? -100 : 100;
        soft[at++] = parity(state & 0x79) ? -100 : 100;
      }
  }
  return soft;
}
for (const nrzm of [0, 1]) {
  const soft = encode(nrzm),
    decoder = await make();
  decoder._browser_init(288000, 72000, 1, nrzm, 0);
  const at = decoder._malloc(65536);
  for (let n = 0; n < soft.length; n += 16384) {
    const s = soft.subarray(n, n + 16384);
    decoder.HEAPU8.set(
      new Uint8Array(s.buffer, s.byteOffset, s.byteLength),
      at,
    );
    decoder._browser_feed_soft(at, s.length);
  }
  const stats = Array.from({ length: 10 }, (_, i) => decoder._browser_stat(i));
  console.log({
    test: nrzm ? "NRZ-M after Viterbi" : "legacy transport",
    stats,
  });
  assert(stats[0] > 90);
  assert(stats[3] > 300);
}
if (process.env.TEST_MODULATION) {
  for (const oqpsk of [0, 1]) {
    const soft = encode(1),
      decoder = await make(),
      rate = 288000;
    decoder._browser_init(rate, 72000, oqpsk, 1, 0);
    const at = decoder._malloc(65536 * 8);
    // Four samples/symbol, Q delayed by half a symbol for OQPSK. Rectangular transmit pulses.
    let cursor = 0;
    const total = (soft.length / 2) * 4;
    while (cursor < total) {
      const count = Math.min(65536, total - cursor),
        out = new Float32Array(count * 2);
      for (let n = 0; n < count; n++) {
        const t = cursor + n,
          si = Math.floor(t / 4) * 2,
          sq = Math.max(0, Math.floor((t - (oqpsk ? 2 : 0)) / 4)) * 2 + 1;
        out[n * 2] = soft[si] / 20000;
        out[n * 2 + 1] = soft[sq] / 20000;
      }
      decoder.HEAPF32.set(out, at / 4);
      decoder._browser_feed(at, count);
      cursor += count;
    }
    const stats = Array.from({ length: 10 }, (_, i) =>
      decoder._browser_stat(i),
    );
    console.log({
      test: oqpsk ? "synthetic OQPSK IQ" : "synthetic QPSK IQ",
      stats,
    });
    assert(stats[0] > 70);
    assert(stats[3] > 200);
  }
  // Exercise the actual USB-rate FIR/decimator and digital Doppler path using
  // a synthetic OQPSK carrier carrying the real captured payloads.
  for (const rate of [1200000, 2400000]) {
    const soft = encode(1),
      decoder = await make();
    decoder._browser_init(rate, 72000, 1, 1, 0);
    const at = decoder._malloc(65536 * 8);
    const total = Math.floor(((soft.length / 2) * rate) / 72000);
    let cursor = 0,
      phase = 0;
    while (cursor < total) {
      const count = Math.min(65536, total - cursor),
        out = new Float32Array(count * 2);
      const frequency = 150000 + 2000 - (400 * (cursor + count / 2)) / rate;
      decoder._browser_tune(frequency);
      for (let n = 0; n < count; n++) {
        const t = cursor + n,
          si = Math.floor((t * 72000) / rate) * 2,
          sq = Math.max(0, Math.floor((t * 72000) / rate - 0.5)) * 2 + 1;
        const i = soft[si] / 700,
          q = soft[sq] / 700,
          c = Math.cos(phase),
          s = Math.sin(phase);
        out[n * 2] = (Math.round((i * c - q * s) * 128 + 127.5) - 127.5) / 128;
        out[n * 2 + 1] =
          (Math.round((i * s + q * c) * 128 + 127.5) - 127.5) / 128;
        phase += (2 * Math.PI * (150000 + 2000 - (400 * t) / rate)) / rate;
        if (phase > Math.PI) phase -= 2 * Math.PI;
      }
      decoder.HEAPF32.set(out, at / 4);
      decoder._browser_feed(at, count);
      cursor += count;
    }
    const stats = Array.from({ length: 10 }, (_, i) =>
      decoder._browser_stat(i),
    );
    console.log({
      test: `synthetic CU8, ${rate / 1e6} MS/s, FIR decimation, changing Doppler`,
      stats,
    });
    assert(stats[0] > 70);
    assert(stats[3] > 200);
  }
}
