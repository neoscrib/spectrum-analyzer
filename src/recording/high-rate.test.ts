import { expect, it } from "vitest";
import { defaults, binRange, validateSettings } from "../model";
import { decoders, compatibility } from "../decoders";
import { sourceDefaults } from "../sources/model";
import { IqRecorder } from "./recorder";
import { captureName } from "./model";
import { inspectCu8Replay } from "./replay";
const settings = {
  ...defaults,
  decoder: "none" as const,
  sampleRate: 20000000,
  span: 20000000,
};
it("keeps wideband display bounds independent of fixed decoder input requirements", () => {
  validateSettings(settings);
  expect(binRange(0, 1024, 8192, 20000000, 20000000)[0]).toBe(0);
  expect(binRange(1023, 1024, 8192, 20000000, 20000000)[1]).toBe(8192);
  const receiver = {
    ...sourceDefaults("hackrf"),
    sampleRate: 20000000,
    nativeRate: 20000000,
  };
  expect(
    compatibility(
      decoders.find((d) => d.id === "none")!,
      receiver,
    ),
  ).toBeNull();
  expect(
    compatibility(
      decoders.find((d) => d.id === "wfm")!,
      receiver,
    ),
  ).toMatch(/requires 2.4/);
  expect(
    compatibility(
      decoders.find((d) => d.id === "meteor")!,
      receiver,
    ),
  ).toMatch(/up to 2.4/);
  // A future wideband plugin can consume the native stream without an implicit
  // conversion to the rate of the existing audio decoders.
  expect(
    compatibility(
      {
        id: "none",
        name: "Wideband test",
        description: "",
        requirements: { minSampleRate: 8000000, bandwidthHz: 6000000 },
        outputs: [],
        bandwidths: [6000000],
      },
      receiver,
    ),
  ).toBeNull();
});
it("uses actual 20 MSPS for duration limits, filename, sample count and SigMF", async () => {
  let written = 0,
    metadata = "";
  const receiver = {
    ...sourceDefaults("hackrf"),
    nativeRate: 20000000,
    sampleRate: 20000000,
  };
  const filename = captureName(settings, "live");
  expect(filename).toContain("20000k");
  const recorder = new IqRecorder(
    {
      filename,
      mode: "disk",
      write: async (bytes) => {
        written += bytes.length;
      },
      close: async () => undefined,
      abort: async () => {},
      saveMetadata: async (text) => {
        metadata = text;
      },
    },
    {
      filename,
      source: "live",
      settings,
      receiver,
      startedAt: "2026-11-25T00:00:00Z",
    },
    0.001,
    () => {},
  );
  recorder.push(new ArrayBuffer(50000));
  await recorder.finish("done");
  expect(written).toBe(40000);
  const meta = JSON.parse(metadata);
  expect(meta.global["core:sample_rate"]).toBe(20000000);
  expect(meta.annotations[0]["core:sample_count"]).toBe(20000);
  expect(meta.global["core:description"]).toContain("0.001000 seconds");
});
it("replays the full wideband SigMF rate and rejects incompatible audio replay", async () => {
  const file = new File([new Uint8Array(32768)], "wide.cu8"),
    meta = new File(
      [
        JSON.stringify({
          global: { "core:datatype": "cu8", "core:sample_rate": 20000000 },
          captures: [{ "core:frequency": 600000000, "core:sample_start": 0 }],
        }),
      ],
      "wide.sigmf-meta",
    );
  const request = await inspectCu8Replay(file, meta, settings);
  expect(request.source.sampleRate).toBe(20000000);
  expect(request.settings).toMatchObject({
    sampleRate: 20000000,
    center: 600000000,
    channel: 600000000,
  });
  await expect(
    inspectCu8Replay(file, meta, { ...defaults, decoder: "wfm" }),
  ).rejects.toThrow(/2.4 MSPS/);
});
