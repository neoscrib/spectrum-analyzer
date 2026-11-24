import { expect, it } from "vitest";
import { inspectIq } from "./iq";
import { DEFAULT_SETTINGS } from "./settings";
function file(bytes: Uint8Array) {
  return {
    size: bytes.length,
    slice: (a: number, b: number) => ({
      arrayBuffer: async () => bytes.slice(a, b).buffer,
    }),
  } as File;
}
function wav(channels = 2) {
  const bytes = new Uint8Array(60),
    v = new DataView(bytes.buffer),
    s = (p: number, t: string) =>
      [...t].forEach((c, i) => (bytes[p + i] = c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 52, true);
  s(8, "WAVE");
  s(12, "JUNK");
  v.setUint32(16, 0, true);
  s(20, "fmt ");
  v.setUint32(24, 16, true);
  v.setUint16(28, 1, true);
  v.setUint16(30, channels, true);
  v.setUint32(32, 187500, true);
  v.setUint16(42, 16, true);
  s(44, "data");
  v.setUint32(48, 8, true);
  return bytes;
}
it("reads real-style chunked stereo WAV with a nonstandard sample rate", async () => {
  expect(await inspectIq(file(wav()), DEFAULT_SETTINGS)).toMatchObject({
    format: "cs16",
    sampleRate: 187500,
    offset: 52,
    length: 8,
  });
});
it("rejects mono audio and incomplete IQ pairs", async () => {
  await expect(inspectIq(file(wav(1)), DEFAULT_SETTINGS)).rejects.toThrow(
    /two channels/,
  );
  await expect(
    inspectIq(file(new Uint8Array(4097)), DEFAULT_SETTINGS),
  ).rejects.toThrow(/pairs/);
});
it("keeps raw capture sample rate and format explicit", async () => {
  expect(
    await inspectIq(file(new Uint8Array(8192)), {
      ...DEFAULT_SETTINGS,
      replayFormat: "cf32",
    }),
  ).toMatchObject({ format: "cf32", sampleRate: 1200000, offset: 0 });
});
