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
        for (const decoder of receivers) {
          const pcm = front
            ? decoder.process_baseband(front.process(iq))
            : decoder.process(iq);
          assert(pcm.every(Number.isFinite));
        }
      };
      for (let n = 0; n < 60; n++) process(); // Warm WASM and active CTCSS/DCS analysis.
      const before = performance.now();
      for (let n = 0; n < 150; n++) process();
      results.push({
        directory,
        kind,
        noise,
        channels,
        cpuPercent: Number(
          (
            (performance.now() - before) /
            (((150 * 65536) / 2400000) * 10)
          ).toFixed(2),
        ),
      });
      receivers.forEach((d) => d.free());
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
