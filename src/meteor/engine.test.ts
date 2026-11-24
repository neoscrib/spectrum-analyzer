// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  readSync,
} from "node:fs";
import { createHash } from "node:crypto";
import createMeteor from "../wasm-meteor/meteor";
import { defaults } from "../model";
import { meteorEngine } from "./engine";
import { MeteorImageStore } from "./image-store";
import { importMeteorProfile } from "./profile";
import { type MeteorStatus, type DecoderInput } from "./model";
import type { DecoderEvent } from "../types";
const wasmBinary = readFileSync(
  new URL("../wasm-meteor/meteor.wasm", import.meta.url),
);
const settings = {
  ...defaults,
  decoder: "meteor" as const,
  center: 137900000,
  channel: 137900000,
  bandwidth: 180000,
};
const fixture = new URL("../../fixtures/meteor_m2_72k.wav", import.meta.url);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function collector() {
  let status: MeteorStatus | undefined;
  const images = new MeteorImageStore();
  return {
    images,
    status: () => status,
    take(events: DecoderEvent[]) {
      for (const e of events) {
        if (e.type === "telemetry" && e.protocol === "meteor")
          status = e.status;
        if (e.type === "image") images.merge(e.image);
      }
    },
  };
}
it.skipIf(!existsSync(fixture)).each([65536, 7291])(
  "matches reference frames and exact real-image pixels across %i-sample buffers",
  async (chunk) => {
    const wav = readFileSync(fixture);
    expect(hash(wav)).toBe(
      "c8be339e69db2b192f852c8ab5d2cb7c7b547552bab41fadd584e0296df0cdf8",
    );
    let at = 12;
    while (wav.toString("ascii", at, at + 4) !== "data")
      at += 8 + wav.readUInt32LE(at + 4);
    const raw = wav.subarray(at + 8),
      native = await createMeteor({ wasmBinary });
    const plugin = meteorEngine(
      {
        ...settings,
        meteor: { ...defaults.meteor, mode: "qpsk", nrzm: false },
      },
      native,
      {
        sampleRate: 187500,
        format: "cs16",
        replay: {
          startSeconds: 0,
          durationSeconds: null,
          frequencyOffsetHz: 0,
        },
      },
    );
    const c = collector();
    for (let at = 0; at < raw.length; at += chunk * 4)
      c.take(plugin.process(raw.subarray(at, at + chunk * 4), at / 4));
    c.take(plugin.process(new Uint8Array(), raw.length / 4));
    expect(c.status()).toMatchObject({
      frames: 903,
      badFrames: 17,
      packets: 3519,
      strips: 3437,
      jpegErrors: 0,
    });
    const images = c.images.images();
    expect(
      images.map((i) => [i.apid, i.width, i.height, hash(i.pixels)]),
    ).toEqual([
      [
        64,
        1568,
        656,
        "261a1e920279c9990a1473cf52fae0f70545cdec3d186967333515b5fcddca57",
      ],
      [
        65,
        1568,
        664,
        "852ac3c0184098790814df882b746707cc81a0deb0289801081001561fe8f881",
      ],
      [
        68,
        1568,
        656,
        "348a42a18e009d0a3564decfd5dc1d1fd8d9fa389b27afad5faeea811949532c",
      ],
    ]);
    plugin.dispose();
    expect(() => plugin.process(new Uint8Array(), 0)).toThrow(/disposed/);
  },
  20000,
);
it("does not invent packets or images from noise, and releases/recreates native state", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const native = await createMeteor({ wasmBinary });
    const plugin = meteorEngine(
      { ...settings, meteor: { ...defaults.meteor, reacquireSeconds: 0.1 } },
      native,
    );
    const noise = new Uint8Array(131072);
    let seed = 1234;
    for (let n = 0; n < noise.length; n++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      noise[n] = 128 + ((seed >>> 0) % 7) - 3;
    }
    const c = collector();
    for (let n = 0; n < 30; n++) c.take(plugin.process(noise, n * 65536));
    c.take(plugin.process(new Uint8Array(), 30 * 65536));
    expect(c.status()).toMatchObject({ frames: 0, packets: 0, strips: 0 });
    expect(c.status()!.reacquisitions).toBeGreaterThan(3);
    expect(c.images.images()).toEqual([]);
    expect(() => plugin.process(new Uint8Array(1), 0)).toThrow(/pair/);
    plugin.dispose();
  }
});
it("rejects unsupported rates, out-of-band recordings and invalid float input", async () => {
  const native = await createMeteor({ wasmBinary });
  expect(() =>
    meteorEngine(settings, native, { format: "cu8", sampleRate: 100000 }),
  ).toThrow(/Sample rate/);
  expect(() =>
    meteorEngine({ ...settings, center: 137750000 }, native, {
      format: "cu8",
      sampleRate: 187500,
    }),
  ).toThrow(/full LRPT/);
  const plugin = meteorEngine(settings, native, {
    format: "cf32",
    sampleRate: 240000,
  });
  expect(() =>
    plugin.process(new Uint8Array(new Float32Array([NaN, 0]).buffer), 0),
  ).toThrow(/non-finite/);
  plugin.dispose();
});
const privateEnabled = process.env.METEOR_PRIVATE_TESTS === "1";
it.skipIf(!privateEnabled)(
  "matches the original modern M2-3 real pass recovery, including historical Doppler",
  async () => {
    const profile = JSON.parse(
      readFileSync(
        "/home/tanner/code/meteor-m/artifacts/nov20-recovered/replay-settings.json",
        "utf8",
      ),
    );
    const imported = importMeteorProfile(profile, settings),
      file =
        process.env.METEOR_CAPTURE ??
        "/home/tanner/meteor-m/2026-11-20T15-57-20.118Z/" + profile.source.name;
    const native = await createMeteor({ wasmBinary }),
      c = collector();
    const input: DecoderInput = {
      sampleRate: imported.sampleRate,
      format: imported.format,
      replay: { ...imported.options, autoBias: false },
    };
    const plugin = meteorEngine(imported.settings, native, input),
      fd = openSync(file, "r"),
      bytes = Buffer.alloc(131072);
    let samples = 0;
    const start = performance.now();
    try {
      for (;;) {
        const count = readSync(fd, bytes, 0, bytes.length, null);
        if (!count) break;
        c.take(plugin.process(bytes.subarray(0, count), samples));
        samples += count / 2;
      }
    } finally {
      closeSync(fd);
    }
    c.take(plugin.process(new Uint8Array(), samples));
    expect(c.status()).toMatchObject({
      frames: 1891,
      packets: 7467,
      strips: 7295,
    });
    expect(
      c.images.images().map((i) => ({
        apid: i.apid,
        width: i.width,
        height: i.height,
        sha256: hash(i.pixels),
      })),
    ).toEqual(profile.expected.channels);
    console.log("Real modern pass:", {
      seconds: samples / input.sampleRate,
      decodeSeconds: (performance.now() - start) / 1000,
      status: c.status(),
    });
    plugin.dispose();
  },
  90000,
);

it.skipIf(!privateEnabled)(
  "automatically acquires real live-shaped IQ from zero bias without changing saved manual tuning",
  async () => {
    const profile = JSON.parse(
      readFileSync(
        "/home/tanner/code/meteor-m/artifacts/nov20-recovered/replay-settings.json",
        "utf8",
      ),
    );
    const imported = importMeteorProfile(profile, settings);
    const file =
      process.env.METEOR_CAPTURE ??
      "/home/tanner/meteor-m/2026-11-20T15-57-20.118Z/" + profile.source.name;
    let samples = 0;
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(
        () =>
          Date.parse(profile.replay.recordingStartUtc) +
          (samples / 1200000) * 1000,
      );
    const native = await createMeteor({ wasmBinary }),
      c = collector();
    const live = {
      ...imported.settings,
      meteor: {
        ...imported.settings.meteor,
        frequencyBiasHz: 0,
        carrierLimitHz: 200,
        reacquireSeconds: 1,
        autoBias: true,
      },
    };
    const plugin = meteorEngine(live, native, {
      sampleRate: 1200000,
      format: "cu8",
    });
    const fd = openSync(file, "r"),
      bytes = Buffer.alloc(131072);
    const start = performance.now();
    let observedImages = 0;
    try {
      for (;;) {
        const count = readSync(fd, bytes, 0, bytes.length, null);
        if (!count) break;
        const events = plugin.process(bytes.subarray(0, count), samples);
        c.take(events);
        samples += count / 2;
        observedImages += events.filter((e) => e.type === "image").length;
      }
      c.take(plugin.process(new Uint8Array(), samples));
      console.log("Real-time AFC on original IQ:", {
        seconds: samples / 1200000,
        decodeSeconds: (performance.now() - start) / 1000,
        status: c.status(),
        observedImages,
      });
      writeFileSync(
        "artifacts/meteor-afc-live-result.json",
        JSON.stringify(
          {
            seconds: samples / 1200000,
            decodeSeconds: (performance.now() - start) / 1000,
            status: c.status(),
            observedImages,
          },
          null,
          2,
        ),
      );
      expect(c.status()!.bias!.confidence).toBe("high");
      expect(Math.abs(c.status()!.bias!.hz! + 2607.2765)).toBeLessThan(40);
      expect(Math.abs(c.status()!.bias!.appliedHz + 2607.2765)).toBeLessThan(
        60,
      );
      expect(c.status()!.bias!.configuredHz).toBe(0);
      expect(c.status()!.bias!.adjustments).toBeGreaterThan(0);
      expect(c.status()!.frames).toBeGreaterThan(300);
      expect(c.status()!.strips).toBeGreaterThan(1000);
      expect(observedImages).toBeGreaterThan(0);
      expect(live.meteor.frequencyBiasHz).toBe(0);
    } finally {
      closeSync(fd);
      plugin.dispose();
      clock.mockRestore();
    }
  },
  120000,
);
it.skipIf(!existsSync(fixture))(
  "hands a small correction to the carrier loop and keeps image/counter state through hot controls",
  async () => {
    const wav = readFileSync(fixture);
    let start = 12;
    while (wav.toString("ascii", start, start + 4) !== "data")
      start += 8 + wav.readUInt32LE(start + 4);
    const raw = wav.subarray(start + 8),
      native = await createMeteor({ wasmBinary });
    const plugin = meteorEngine(
      {
        ...settings,
        meteor: { ...defaults.meteor, mode: "qpsk", nrzm: false },
      },
      native,
      { sampleRate: 187500, format: "cs16" },
    );
    for (let at = 0; at < 187500 * 5 * 4; at += 65536 * 4)
      plugin.process(raw.subarray(at, at + 65536 * 4), at / 4);
    const frames = native._browser_stat(0),
      height = native._browser_height(0),
      carrier = native._browser_carrier();
    expect(frames).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    plugin.setMeteorBias!({ action: "apply", biasHz: 50 });
    expect(native._browser_carrier()).toBeCloseTo(carrier - 50, 2);
    expect(native._browser_stat(0)).toBe(frames);
    expect(native._browser_height(0)).toBe(height);
    plugin.setMeteorBias!({ action: "estimate", enabled: true });
    expect(native._browser_bias_iq()).toBeGreaterThan(0);
    plugin.setMeteorBias!({ action: "estimate", enabled: false });
    expect(native._browser_bias_iq()).toBe(0);
    plugin.setMeteorBias!({ action: "apply", biasHz: 1000 });
    expect(native._browser_stat(0)).toBe(frames);
    expect(native._browser_height(0)).toBe(height);
    plugin.setMeteorBias!({ action: "auto", enabled: true });
    expect(native._browser_bias_iq()).toBe(0);
    expect(() =>
      plugin.setMeteorBias!({ action: "apply", biasHz: NaN }),
    ).toThrow(/bandwidth/);
    plugin.dispose();
  },
);
it.each([0, 1])(
  "keeps frequency handoff in physical hertz for QPSK/OQPSK mode %i",
  async (oqpsk) => {
    const native = await createMeteor({ wasmBinary });
    native._browser_init(240000, 72000, oqpsk, oqpsk, 0);
    native._browser_tune(0);
    native._browser_bias_tune(100, 1);
    expect(native._browser_carrier()).toBeCloseTo(-100, 2);
    native._browser_bias_tune(40, 1);
    expect(native._browser_carrier()).toBeCloseTo(-40, 2);
    expect(native._browser_stat(10)).toBe(0);
    native._browser_close();
  },
);
