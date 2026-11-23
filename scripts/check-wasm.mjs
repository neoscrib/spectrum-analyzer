import assert from "node:assert/strict";
import { receiverModule } from "./wasm-receivers.mjs";
const { WfmDecoder } = await receiverModule("wfm");

const rate = 2_400_000,
  duration = 0.4;
const iq = new Uint8Array(rate * duration * 2);
let phase = 0;
for (let n = 0; n < iq.length / 2; n++) {
  phase +=
    (2 *
      Math.PI *
      (375000 + 60000 * Math.sin((2 * Math.PI * 1000 * n) / rate))) /
    rate;
  iq[2 * n] = Math.round(127.5 + 80 * Math.cos(phase));
  iq[2 * n + 1] = Math.round(127.5 + 80 * Math.sin(phase));
}
const decoder = new WfmDecoder(375000, 200000, 75);
const start = performance.now();
const output = [];
for (let at = 0; at < iq.length; at += 131072)
  output.push(...decoder.process(iq.subarray(at, at + 131072)));
const elapsed = performance.now() - start;
decoder.free();
assert.equal(output.length, 38400);
let re = 0,
  im = 0,
  noiseRe = 0,
  noiseIm = 0;
const stable = output.filter((_, n) => n % 2 === 0).slice(1500);
for (let n = 0; n < stable.length; n++) {
  re += stable[n] * Math.cos((2 * Math.PI * 1000 * n) / 48000);
  im += stable[n] * Math.sin((2 * Math.PI * 1000 * n) / 48000);
  noiseRe += stable[n] * Math.cos((2 * Math.PI * 3000 * n) / 48000);
  noiseIm += stable[n] * Math.sin((2 * Math.PI * 3000 * n) / 48000);
}
const tone = (2 * Math.hypot(re, im)) / stable.length;
const harmonic = (2 * Math.hypot(noiseRe, noiseIm)) / stable.length;
assert(tone > 0.65 && tone < 0.8, `Recovered 1 kHz amplitude ${tone}`);
assert(harmonic < 0.01, `Unexpected harmonic ${harmonic}`);
assert(output.every(Number.isFinite));
console.log(
  `Real WASM: ${output.length} PCM samples; 1 kHz amplitude ${tone.toFixed(4)}; third harmonic ${harmonic.toFixed(5)}; ${elapsed.toFixed(1)} ms for 400 ms of IQ (${(elapsed / 4).toFixed(1)}% of real time).`,
);

// Independent ITU pilot-tone multiplex fixture, including a nonzero pilot phase
// and 1 Hz frequency error. Check the actual generated WASM, not a JS decoder.
const stereoIq = new Uint8Array(rate * 0.6 * 2);
phase = 0;
for (let n = 0; n < stereoIq.length / 2; n++) {
  const t = n / rate,
    theta = 2 * Math.PI * 19001 * t + 1.1;
  const left = 0.5 * Math.sin(2 * Math.PI * 1000 * t);
  const right = 0.5 * Math.sin(2 * Math.PI * 2000 * t);
  const mpx =
    (left + right) / 2 +
    ((left - right) / 2) * Math.sin(2 * theta) +
    0.09 * Math.sin(theta);
  phase += (2 * Math.PI * (-425000 + 75000 * mpx)) / rate;
  stereoIq[n * 2] = Math.round(127.5 + 80 * Math.cos(phase));
  stereoIq[n * 2 + 1] = Math.round(127.5 + 80 * Math.sin(phase));
}
const stereoDecoder = new WfmDecoder(-425000, 200000, 0);
const stereoOutput = [];
for (let at = 0; at < stereoIq.length; at += 131072)
  stereoOutput.push(
    ...stereoDecoder.process(stereoIq.subarray(at, at + 131072)),
  );
assert.equal(stereoOutput.length, 57600);
assert(stereoDecoder.stereo_locked(), "Stereo pilot must lock");
const pilotLevel = stereoDecoder.pilot_level();
stereoDecoder.free();
const left = stereoOutput.filter((_, n) => n % 2 === 0).slice(-9600);
const right = stereoOutput.filter((_, n) => n % 2 === 1).slice(-9600);
function amplitude(samples, hz) {
  let re = 0,
    im = 0;
  for (let n = 0; n < samples.length; n++) {
    re += samples[n] * Math.cos((2 * Math.PI * hz * n) / 48000);
    im += samples[n] * Math.sin((2 * Math.PI * hz * n) / 48000);
  }
  return (2 * Math.hypot(re, im)) / samples.length;
}
const leftSignal = amplitude(left, 1000),
  rightSignal = amplitude(right, 2000);
const separationLeft = 20 * Math.log10(leftSignal / amplitude(left, 2000));
const separationRight = 20 * Math.log10(rightSignal / amplitude(right, 1000));
assert(leftSignal > 0.4 && rightSignal > 0.4);
assert(
  separationLeft > 40 && separationRight > 40,
  `Poor stereo separation: ${separationLeft}/${separationRight} dB`,
);
assert(stereoOutput.every(Number.isFinite));
console.log(
  `Real stereo WASM: pilot ${(pilotLevel * 100).toFixed(1)}%; L/R separation ${separationLeft.toFixed(1)}/${separationRight.toFixed(1)} dB; left 1 kHz, right 2 kHz.`,
);
