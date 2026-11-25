import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Periodic fixtures can be replayed at a fixed input rate without generating RF
// on the browser's main thread or waiting for the decoder to request samples.
export function performanceIq(kind, noise = false) {
  const count = 65536,
    rate = 2400000,
    iq = new Uint8Array(count * 2);
  let seed = 123456789,
    phase = 0;
  for (let n = 0; n < count; n++) {
    if (noise) {
      for (let c = 0; c < 2; c++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        iq[n * 2 + c] = 48 + ((seed >>> 0) % 160);
      }
      continue;
    }
    const t = n / count,
      voice = Math.sin(2 * Math.PI * 27 * t);
    const pilot = 2 * Math.PI * 519 * t + 0.7;
    const multiplex =
      0.3 * voice +
      0.3 * Math.sin(2 * Math.PI * 54 * t) +
      0.3 * (voice - Math.sin(2 * Math.PI * 54 * t)) * Math.sin(2 * pilot) +
      0.09 * Math.sin(pilot);
    phase +=
      (2 *
        Math.PI *
        (187500 +
          (kind === "wfm"
            ? 75000 * multiplex
            : kind === "nfm"
              ? 1800 * voice
              : 0))) /
      rate;
    const amplitude = kind === "am" ? 45 * (1 + 0.6 * voice) : 70;
    iq[n * 2] = Math.round(127.5 + amplitude * Math.cos(phase));
    iq[n * 2 + 1] = Math.round(127.5 + amplitude * Math.sin(phase));
  }
  return iq;
}

async function benchmark() {
  const results = [];
  const sameEnabled = process.env.SAME_ENABLED === "1";
  let sameModule;
  if (sameEnabled) {
    sameModule = await import("../src/wasm/same.js");
    await sameModule.default({
      module_or_path: await readFile("src/wasm/same_bg.wasm"),
    });
  }
  for (const directory of [process.env.DSP_BASELINE_DIR, "src/wasm"].filter(
    Boolean,
  )) {
    const native = {};
    for (const name of ["dsp_core", "wfm", "am", "nfm"]) {
      const module = await import(
        pathToFileURL(resolve(directory, `${name}.js`))
      );
      await module.default({
        module_or_path: await readFile(resolve(directory, `${name}_bg.wasm`)),
      });
      native[name] = module;
    }
    for (const [kind, noise, channels] of [
      ["wfm", false, 1],
      ["wfm", true, 1],
      ["am", false, 1],
      ["am", true, 1],
      ["nfm", false, 1],
      ["nfm", true, 1],
      ["nfm", false, 15],
    ]) {
      const iq = performanceIq(kind, noise);
      const front =
        kind === "nfm"
          ? null
          : kind === "wfm" && native.dsp_core.Channelizer.wfm
            ? native.dsp_core.Channelizer.wfm(187500, 200000)
            : new native.dsp_core.Channelizer(
                187500,
                kind === "wfm" ? 95000 : 90000,
                kind === "wfm" ? 401 : 121,
                10,
              );
      const receivers =
        kind === "wfm"
          ? [new native.wfm.WfmDecoder(187500, 200000, 75)]
          : kind === "am"
            ? [new native.am.AmDecoder(187500, 10000)]
            : Array.from(
                { length: channels },
                (_, i) =>
                  new native.nfm.NfmDecoder(
                    187500 + i * 12500,
                    12500,
                    2500,
                    -120,
                  ),
              );
      const process = () => {
        for (const [index, decoder] of receivers.entries()) {
          const pcm = front
            ? decoder.process_baseband(front.process(iq))
            : decoder.process(iq);
          assert(pcm.every(Number.isFinite));
          if (sameEnabled) {
            sameReceivers[index].process_audio(decoder.take_audio_tap());
            if (sameReceivers[index].has_events())
              sameReceivers[index].take_events();
          }
        }
      };
      const sameReceivers = sameEnabled
        ? receivers.map((decoder) => {
            assert(
              decoder.set_audio_tap_enabled,
              "This baseline predates SAME audio taps.",
            );
            decoder.set_audio_tap_enabled(true);
            return new sameModule.SameDecoder(kind === "nfm" ? 24000 : 48000);
          })
        : [];
      for (let n = 0; n < 60; n++) process(); // Warm WASM and active CTCSS/DCS analysis.
      // Median of five rounds reduces JIT/scheduling noise in small CPU gains.
      const rounds = [];
      for (let round = 0; round < 5; round++) {
        const before = performance.now();
        for (let n = 0; n < 150; n++) process();
        rounds.push(
          (performance.now() - before) / (((150 * 65536) / 2400000) * 10),
        );
      }
      rounds.sort((a, b) => a - b);
      results.push({
        directory,
        kind,
        noise,
        channels,
        sameEnabled,
        cpuPercent: Number(rounds[2].toFixed(2)),
        minCpuPercent: Number(rounds[0].toFixed(2)),
        maxCpuPercent: Number(rounds[4].toFixed(2)),
      });
      receivers.forEach((d) => d.free());
      sameReceivers.forEach((d) => d.free());
      front?.free();
    }
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/dsp-performance.json",
    JSON.stringify(results, null, 2),
  );
  console.table(results);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await benchmark();
