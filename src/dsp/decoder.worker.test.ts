import { afterEach, expect, it, vi } from "vitest";
import { defaults } from "../model";
import type { DecoderRequest } from "./decoder-protocol";
const created = vi.hoisted(() => ({ count: 0, disposed: 0 }));
vi.mock("./plugins", () => ({
  createDecoder: vi.fn(async () => {
    created.count++;
    return {
      process: () => [],
      dispose: () => {
        created.disposed++;
      },
    };
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("preserves sequential Meteor buffers but creates fresh state after gaps and sample-rate changes", async () => {
  const surface: {
    onmessage?: (e: { data: DecoderRequest & { id: number } }) => void;
  } = {};
  const send = vi.fn();
  vi.stubGlobal("self", surface);
  vi.stubGlobal("postMessage", send);
  await import("./decoder.worker");
  let id = 0;
  async function dispatch(data: DecoderRequest) {
    const request = ++id;
    surface.onmessage!({ data: { ...data, id: request } });
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ id: request, type: "done" }),
        ...(data.type === "process" ? [expect.any(Array)] : []),
      ),
    );
  }
  const configure: DecoderRequest = {
    type: "configure",
    settings: { ...defaults, decoder: "meteor" },
    policy: { defaultListen: true, rules: [] },
    monitor: null,
    multiplex: false,
    input: { format: "cu8", sampleRate: 2400000 },
  };
  await dispatch(configure);
  await dispatch({
    type: "process",
    firstSample: 0,
    data: new ArrayBuffer(20),
  });
  await dispatch({
    type: "process",
    firstSample: 10,
    data: new ArrayBuffer(14),
  });
  expect(created).toEqual({ count: 1, disposed: 0 });
  await dispatch({
    type: "process",
    firstSample: 40,
    data: new ArrayBuffer(20),
  });
  expect(created).toEqual({ count: 2, disposed: 1 });
  await dispatch({
    ...configure,
    input: { format: "cs16", sampleRate: 187500 },
  });
  await dispatch({
    type: "process",
    firstSample: 0,
    data: new ArrayBuffer(28),
  });
  await dispatch({
    type: "process",
    firstSample: 7,
    data: new ArrayBuffer(12),
  });
  expect(created).toEqual({ count: 3, disposed: 2 });
});
