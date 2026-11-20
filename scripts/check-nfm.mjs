import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { NfmDecoder } from "../src/wasm/spectrum_dsp.js";
import { NfmTestSignal } from "../src/dsp/nfm-synthetic.ts";
await init({
  module_or_path: await readFile(
    new URL("../src/wasm/spectrum_dsp_bg.wasm", import.meta.url),
  ),
});
const source = new NfmTestSignal(),
  a = new NfmDecoder(162500, 12500, 2500, -65),
  b = new NfmDecoder(187500, 12500, 2500, -65);
let ctcss = false,
  dcs = false,
  closed = false,
  finite = true,
  pcm = 0;
const start = performance.now();
for (let sample = 0; sample < 2400000 * 6.5; sample += 65536) {
  const iq = source.process(462400000);
  const aa = a.process(iq),
    bb = b.process(iq);
  finite &&= aa.every(Number.isFinite) && bb.every(Number.isFinite);
  pcm += aa.length;
  const sa = JSON.parse(a.status()),
    sb = JSON.parse(b.status());
  ctcss ||= sa.ctcss === 100;
  dcs ||= sb.dcs.some((c) => c.code === "023" && !c.inverted);
  if (sample > 2400000 * 6.2) closed = !sa.carrier && !sb.carrier;
}
assert(ctcss, "CTCSS did not decode from CU8");
assert(dcs, "DCS did not decode from CU8");
assert(closed, "Squelch did not close after the calls");
assert(finite);
assert(pcm > 600000);
a.free();
b.free();
const receivers = Array.from(
  { length: 15 },
  (_, i) => new NfmDecoder(150000 + i * 12500, 12500, 2500, -65),
);
const quiet = new Uint8Array(131072).fill(128);
const t = performance.now();
for (let n = 0; n < 37; n++) for (const r of receivers) r.process(quiet);
const bankMs = performance.now() - t;
receivers.forEach((r) => r.free());
console.log("Actual NFM WASM:", {
  ctcss100: ctcss,
  dcs023N: dcs,
  squelchReleased: closed,
  finite,
  pcm,
  iqTestMs: Math.round(t - start),
  fifteenReceiversPerRfSecondMs: Math.round(bankMs),
});
