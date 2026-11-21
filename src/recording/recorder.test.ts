import { expect, it } from "vitest";
import { defaults } from "../model";
import {
  BYTE_RATE,
  captureMetadata,
  metadataName,
  type RecordingSink,
} from "./model";
import { IqRecorder } from "./recorder";
import { downloadSink } from "./storage";
const info = {
  filename: "test.cu8",
  source: "test" as const,
  settings: defaults,
  startedAt: "2026-11-20T18:00:00Z",
};
const buffer = (...bytes: number[]) => new Uint8Array(bytes).buffer;
function disk(overrides: Partial<RecordingSink> = {}): RecordingSink {
  return {
    filename: "test.cu8",
    mode: "disk",
    write: async () => {},
    close: async () => undefined,
    abort: async () => {},
    saveMetadata: async () => {},
    ...overrides,
  };
}
it("saves an exact contiguous byte prefix, full IQ pairs, and SigMF metadata", async () => {
  const recorder = new IqRecorder(
    downloadSink("test.cu8"),
    info,
    6 / BYTE_RATE,
    () => {},
  );
  recorder.push(buffer(0, 255, 127, 128));
  recorder.push(buffer(1, 2, 3, 4));
  await recorder.finish("User stop must not override the automatic reason");
  expect(recorder.state.phase).toBe("complete");
  expect(recorder.state.bytes).toBe(6);
  expect(recorder.state.reason).toBe("Requested duration reached");
  expect(new Uint8Array(await recorder.state.blob!.arrayBuffer())).toEqual(
    new Uint8Array([0, 255, 127, 128, 1, 2]),
  );
  const meta = JSON.parse(recorder.state.metadata!);
  expect(meta.global).toMatchObject({
    "core:datatype": "cu8",
    "core:sample_rate": 2400000,
    "core:dataset": "test.cu8",
  });
  expect(meta.global["core:description"]).toContain("GENERATED");
  expect(meta.captures[0]).toMatchObject({
    "core:sample_start": 0,
    "core:frequency": defaults.center,
  });
  expect(meta.annotations[0]["core:sample_count"]).toBe(3);
  expect(metadataName("fan.cu8")).toBe("fan.sigmf-meta");
});
it("bounds download memory and serializes disk writes without blocking the sample producer", async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: number[][] = [];
  let closes = 0;
  const recorder = new IqRecorder(
    disk({
      write: async (data) => {
        writes.push([...data]);
        await pending;
      },
      close: async () => {
        closes++;
        return undefined;
      },
    }),
    info,
    0,
    () => {},
    { memory: 8, queue: 8 },
  );
  recorder.push(buffer(1, 2, 3, 4));
  recorder.push(buffer(5, 6, 7, 8));
  recorder.push(buffer(9, 10)); // Ends capture; never skips then resumes.
  expect(recorder.state.phase).toBe("saving");
  expect(recorder.state.bytes).toBe(8);
  expect(writes).toEqual([[1, 2, 3, 4]]);
  expect(closes).toBe(0);
  release();
  await recorder.finish("stop");
  expect(writes).toEqual([
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]);
  expect(closes).toBe(1);
  expect(recorder.state.reason).toContain("could not keep up");
  expect(recorder.state.dataSaved).toBe(true);
  const mem = new IqRecorder(downloadSink("test.cu8"), info, 0, () => {}, {
    memory: 6,
    queue: 100,
  });
  mem.push(buffer(1, 2, 3, 4, 5, 6, 7, 8));
  await mem.finish("stop");
  expect(mem.state.bytes).toBe(6);
  expect(mem.state.reason).toBe("Download memory limit reached");
});
it("reports write failures and preserves downloadable metadata if only the sidecar fails", async () => {
  let aborted = false;
  const recorder = new IqRecorder(
    disk({
      write: async () => {
        throw Error("Disk full");
      },
      abort: async () => {
        aborted = true;
      },
    }),
    info,
    0,
    () => {},
  );
  recorder.push(buffer(1, 2));
  await recorder.finish("stop");
  expect(recorder.state.phase).toBe("error");
  expect(recorder.state.dataSaved).toBe(false);
  expect(recorder.state.reason).toContain("Disk full");
  expect(aborted).toBe(true);
  const sidecar = new IqRecorder(
    disk({
      saveMetadata: async () => {
        throw Error("Permission revoked");
      },
    }),
    info,
    0,
    () => {},
  );
  sidecar.push(buffer(1, 2));
  await sidecar.finish("stop");
  expect(sidecar.state.phase).toBe("error");
  expect(sidecar.state.dataSaved).toBe(true);
  expect(sidecar.state.metadataSaved).toBe(false);
  expect(
    JSON.parse(sidecar.state.metadata!).annotations[0]["core:sample_count"],
  ).toBe(1);
});
it("captures immutable RF settings and rejects malformed IQ or invalid limits", async () => {
  const settings = { ...defaults };
  const recorder = new IqRecorder(
    downloadSink("test.cu8"),
    { ...info, source: "live", settings },
    0,
    () => {},
  );
  settings.center = 500e6;
  recorder.push(buffer(1, 2));
  recorder.push(buffer(3));
  await recorder.finish("stop");
  expect(recorder.state.bytes).toBe(2);
  expect(recorder.state.reason).toContain("incomplete IQ pair");
  const meta = JSON.parse(recorder.state.metadata!);
  expect(meta.captures[0]["core:frequency"]).toBe(defaults.center);
  expect(meta.global["core:description"]).toContain("Live RTL-SDR");
  expect(() => new IqRecorder(disk(), info, -1, () => {})).toThrow();
  expect(() => new IqRecorder(disk(), info, Infinity, () => {})).toThrow();
  expect(JSON.parse(captureMetadata(info, 0, "No samples")).captures).toEqual(
    [],
  );
});
