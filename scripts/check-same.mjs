import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { loadWasm, receiverModule } from "./wasm-receivers.mjs";
import { inspectAudioWav, monoAudio } from "../src/same/wav.ts";
import {
  sameFixture,
  TEST_HEADER,
  NWS_REFERENCE_HEADER,
} from "../src/same/fixtures.ts";
const { SameDecoder, default: init } = await loadWasm("same");
const wasm = await init();
function decode(samples, rate, parts = [997, 61, 8192, 3]) {
  const d = new SameDecoder(rate),
    events = [];
  let at = 0,
    n = 0;
  const before = performance.now();
  while (at < samples.length) {
    const end = Math.min(samples.length, at + parts[n++ % parts.length]);
    d.process_audio(samples.subarray(at, end));
    at = end;
    if (d.has_events()) events.push(...JSON.parse(d.take_events()));
  }
  const ms = performance.now() - before,
    status = JSON.parse(d.status());
  d.free();
  return { events, ms, status };
}
const messages = (result) => result.events.filter((e) => e.kind === "message");
const single = decode(sameFixture(24000, [TEST_HEADER], { eom: false }), 24000);
assert(
  single.events.some(
    (e) => e.kind === "burst" && e.raw.startsWith(TEST_HEADER),
  ),
  "Single header estimate must be available, without claiming repeated verification",
);
assert.equal(messages(single).length, 0);
// Upstream voice-window expiration must never masquerade as received NNNN.
const timeoutDecoder = new SameDecoder(24000);
timeoutDecoder.process_audio(sameFixture(24000, undefined, { eom: false }));
timeoutDecoder.take_events();
const quietSecond = new Float32Array(24000),
  timeoutEvents = [];
for (let n = 0; n < 140; n++) {
  timeoutDecoder.process_audio(quietSecond);
  if (timeoutDecoder.has_events())
    timeoutEvents.push(...JSON.parse(timeoutDecoder.take_events()));
}
assert(!timeoutEvents.some((e) => e.kind === "message" && e.raw === "NNNN"));
assert(JSON.parse(timeoutDecoder.status()).timedOut > 0);
timeoutDecoder.free();
for (const rate of [8000, 22050, 24000, 44100, 48000, 96000]) {
  const audio = sameFixture(rate),
    result = decode(audio, rate);
  assert(
    messages(result).some((e) => e.raw === TEST_HEADER),
    `No header at ${rate} Hz`,
  );
  assert(
    messages(result).some((e) => e.raw === "NNNN"),
    `No EOM at ${rate} Hz`,
  );
}
const audio = sameFixture(48000);
assert(
  messages(
    decode(sameFixture(24000, Array(3).fill(NWS_REFERENCE_HEADER)), 24000),
  ).some((e) => e.raw === NWS_REFERENCE_HEADER),
  "Published NWS Appendix A.3.2 vector must decode",
);
const maximumHeader = TEST_HEADER.replace(
  "027065-027095",
  Array.from(
    { length: 31 },
    (_, n) => `027${String(n * 2 + 1).padStart(3, "0")}`,
  ).join("-"),
);
assert(
  messages(
    decode(sameFixture(24000, Array(3).fill(maximumHeader)), 24000),
  ).some((e) => e.raw === maximumHeader),
  "Maximum 31-area header must decode without frame timeout",
);
assert(
  messages(
    decode(sameFixture(24000, undefined, { highPadding: true }), 24000),
  ).some((e) => e.raw === TEST_HEADER),
  "Permitted high eighth padding bits must decode",
);
assert.deepEqual(
  decode(audio, 48000).events,
  decode(audio, 48000, [audio.length]).events,
  "Arbitrary chunks must preserve exact event timing/data",
);
const badHeaders = [17, 23, 29].map(
  (p) =>
    TEST_HEADER.slice(0, p) +
    String.fromCharCode(TEST_HEADER.charCodeAt(p) ^ 1) +
    TEST_HEADER.slice(p + 1),
);
const recovered = decode(sameFixture(24000, badHeaders, { eom: false }), 24000);
assert(
  messages(recovered).some((e) => e.raw === TEST_HEADER && e.voted > 0),
  "Three independently damaged bursts must recover the original header",
);
for (const options of [
  { ppm: 2500, frequencyOffset: 15, noise: 0.06 },
  { ppm: -2000, frequencyOffset: -15, noise: 0.04, distorted: true },
]) {
  assert(
    messages(decode(sameFixture(24000, undefined, options), 24000)).some(
      (e) => e.raw === TEST_HEADER,
    ),
    `Distorted/timing-offset decode failed: ${JSON.stringify(options)}`,
  );
}
for (const attention of ["noaa1050", "easDual"]) {
  const result = decode(
    sameFixture(24000, [], { attention, eom: false }),
    24000,
  );
  const start = result.events.find(
    (e) => e.kind === "tone" && e.edge === "start" && e.tone === attention,
  );
  const end = result.events.find(
    (e) => e.kind === "tone" && e.edge === "end" && e.tone === attention,
  );
  assert(start && end, `Missing ${attention} observation`);
  assert(
    Math.abs(end.end - end.start - 8.4) < 0.12,
    `Wrong duration: ${JSON.stringify(end)}`,
  );
  assert.equal(
    messages(result).length,
    0,
    "An attention tone alone is not an alert",
  );
}
const sequence = new Float32Array([
  ...sameFixture(24000),
  ...sameFixture(24000, [
    TEST_HEADER.replace("RWT", "RMT"),
    TEST_HEADER.replace("RWT", "RMT"),
    TEST_HEADER.replace("RWT", "RMT"),
  ]),
]);
const consecutive = messages(decode(sequence, 24000));
assert(
  consecutive.some((e) => e.raw.includes("-RMT-")) &&
    consecutive.some((e) => e.raw.includes("-RWT-")),
);
for (const header of [
  TEST_HEADER.slice(0, -8),
  "ZCZC-WXR-TOR-027065",
  "ZCZC-not-an-alert",
]) {
  assert(
    !messages(decode(sameFixture(24000, [header], { eom: false }), 24000)).some(
      (e) => e.raw.startsWith("ZCZC"),
    ),
    "Incomplete single bursts must not become verified messages",
  );
}
const negative = new Float32Array(24000 * 20);
let seed = 23456789;
for (let n = 0; n < negative.length; n++) {
  const t = n / 24000;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  const speech =
    (0.3 + 0.15 * Math.sin(2 * Math.PI * 3.3 * t)) *
    (Math.sin(2 * Math.PI * 130 * t) +
      0.5 * Math.sin(2 * Math.PI * 730 * t) +
      0.3 * Math.sin(2 * Math.PI * 1750 * t));
  negative[n] =
    n < 24000
      ? 0
      : 0.15 * speech +
        0.08 * Math.sin(2 * Math.PI * 261.63 * t) +
        0.04 * Math.sin(2 * Math.PI * 392 * t) +
        0.035 * ((seed >>> 0) / 2147483648 - 1);
}
const noAlerts = decode(negative, 24000);
assert.equal(messages(noAlerts).length, 0);
assert(!noAlerts.events.some((e) => e.kind === "tone"));
const speechFile = new Blob([
  await readFile(new URL("../fixtures/same/speech.wav", import.meta.url)),
]);
const speechFormat = await inspectAudioWav(speechFile);
const speech = monoAudio(
  await speechFile
    .slice(speechFormat.offset, speechFormat.offset + speechFormat.length)
    .arrayBuffer(),
  speechFormat,
);
const speechResult = decode(speech, speechFormat.rate);
assert.equal(
  messages(speechResult).length,
  0,
  "Ordinary spoken audio must not create SAME messages",
);
assert(
  !speechResult.events.some((e) => e.kind === "tone"),
  "Ordinary spoken audio must not create attention-tone observations",
);
// A persistent valid-ASCII modulation deliberately lacks a header terminator.
const d = new SameDecoder(8000),
  endless = sameFixture(8000, ["ZCZC-" + "0".repeat(2000)], { eom: false });
d.process_audio(endless);
const bounded = JSON.parse(d.status());
assert(bounded.rejected > 0, "Oversize framer must reset");
assert(JSON.parse(d.take_events()).length <= 64);
d.free();
const long = new SameDecoder(24000),
  steady = negative.subarray(24000, 48000);
let warmBytes;
for (let n = 0; n < 600; n++) {
  long.process_audio(steady);
  if (long.has_events()) long.take_events();
  if (n === 100) warmBytes = wasm.memory.buffer.byteLength;
}
assert.equal(
  wasm.memory.buffer.byteLength,
  warmBytes,
  "Ten minutes of streaming must not grow WASM memory after warmup",
);
long.free();
// Exercise actual RF channelizers, demodulators, pre-mute taps, and SAME WASM.
const rfResults = [];
for (const kind of ["am", "nfm", "wfm"]) {
  const {
    [kind === "am"
      ? "AmDecoder"
      : kind === "nfm"
        ? "NfmDecoder"
        : "WfmDecoder"]: Receiver,
  } = await receiverModule(kind);
  const decoder =
    kind === "nfm"
      ? new Receiver(187500, 25000, 5000, -5)
      : new Receiver(187500, kind === "am" ? 10000 : 200000, 75);
  decoder.set_audio_tap_enabled(true);
  const rate = kind === "nfm" ? 24000 : 48000,
    same = new SameDecoder(rate),
    source = sameFixture(48000),
    iq = new Uint8Array(65536 * 2),
    events = [];
  let phase = 0,
    nonzero = 0;
  const before = performance.now();
  const count = source.length * 50;
  for (let at = 0; at < count; at += 65536) {
    const length = Math.min(65536, count - at);
    for (let n = 0; n < length; n++) {
      const index = (at + n) / 50,
        lo = Math.floor(index),
        fraction = index - lo;
      const sample =
        source[lo] * (1 - fraction) +
        (source[Math.min(lo + 1, source.length - 1)] ?? 0) * fraction;
      phase +=
        (2 *
          Math.PI *
          (187500 +
            (kind === "am" ? 0 : sample * (kind === "nfm" ? 4200 : 65000)))) /
        2400000;
      const amplitude = kind === "am" ? 50 * (1 + 0.65 * sample) : 70;
      iq[n * 2] = Math.round(127.5 + amplitude * Math.cos(phase));
      iq[n * 2 + 1] = Math.round(127.5 + amplitude * Math.sin(phase));
    }
    const pcm = decoder.process(iq.subarray(0, length * 2));
    if (pcm.some((x) => Math.abs(x) > 0.001)) nonzero++;
    same.process_audio(decoder.take_audio_tap());
    if (same.has_events()) events.push(...JSON.parse(same.take_events()));
  }
  assert(
    events.some((e) => e.kind === "message" && e.raw === TEST_HEADER),
    `${kind}: RF-to-SAME failed`,
  );
  assert(
    kind === "nfm" ? nonzero === 0 : nonzero > 0,
    `${kind}: squelch/playback behavior changed`,
  );
  rfResults.push({
    kind,
    seconds: source.length / 48000,
    elapsedMs: performance.now() - before,
    header: true,
    muted: kind === "nfm",
  });
  same.free();
  decoder.free();
}
await mkdir("artifacts", { recursive: true });
// Independent decoder input / human-inspectable PCM WAV fixture.
const fixture = sameFixture(22050),
  raw = Buffer.alloc(fixture.length * 2);
for (let n = 0; n < fixture.length; n++)
  raw.writeInt16LE(Math.round(fixture[n] * 28000), n * 2);
await writeFile("artifacts/same-reference.s16", raw);
await writeFile(
  "artifacts/same-validation.json",
  JSON.stringify(
    {
      header: TEST_HEADER,
      rfResults,
      recovery: messages(recovered),
      negativeFrames: messages(noAlerts),
      longRunSeconds: 600,
      boundedBytes: warmBytes,
    },
    null,
    2,
  ),
);
console.log(
  "SAME WASM: headers/EOM, three-burst recovery, six sample rates, exact chunking, offsets/noise/clipping, both attention tones, negatives, bounded ten-minute streaming, RF-to-audio taps:",
  rfResults,
);
