import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaults, SAMPLE_RATE } from "./model";
import type { WorkerIn, WorkerOut } from "./types";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@jtarrio/webrtlsdr/rtlsdr.js", () => ({
  RTL2832U_Provider: class {
    get = mocks.get;
  },
}));
import { RadioSession } from "./radio";
import { starterLibrary, captureWindows } from "./presets/model";

let device: ReturnType<typeof makeDevice>;
let reads: {
  resolve: (block: { data: ArrayBuffer }) => void;
  reject: (error: Error) => void;
}[];
let workers: FakeWorker[];
function makeDevice() {
  return {
    setSampleRate: vi.fn(async (rate: number) => rate),
    setFrequencyCorrection: vi.fn(async () => {}),
    setCenterFrequency: vi.fn(async () => {}),
    setGain: vi.fn(async () => {}),
    enableBiasTee: vi.fn(async () => {}),
    resetBuffer: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    readSamples: vi.fn(
      () =>
        new Promise<{ data: ArrayBuffer }>((resolve, reject) =>
          reads.push({ resolve, reject }),
        ),
    ),
  };
}
class FakeWorker {
  onmessage?: (event: { data: WorkerOut }) => void;
  onerror?: (event: { message: string }) => void;
  messages: WorkerIn[] = [];
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
  postMessage(message: WorkerIn) {
    this.messages.push(message);
    if (message.type === "init")
      queueMicrotask(() => this.onmessage?.({ data: { type: "ready" } }));
  }
}
beforeEach(() => {
  reads = [];
  workers = [];
  device = makeDevice();
  mocks.get.mockReset().mockResolvedValue(device);
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { usb: {} });
});
afterEach(() => vi.unstubAllGlobals());
async function pair() {
  const pending = reads.splice(0, 2);
  expect(pending).toHaveLength(2);
  for (const read of pending) read.resolve({ data: new ArrayBuffer(131072) });
  await new Promise((resolve) => setTimeout(resolve, 0));
}
async function stop(session: RadioSession) {
  const stopping = session.stop();
  for (const read of reads.splice(0))
    read.resolve({ data: new ArrayBuffer(131072) });
  await stopping;
}

it("opens the USB chooser in the click gesture, then initializes fixed-rate acquisition", async () => {
  const session = new RadioSession();
  const opening = session.connect(defaults);
  expect(mocks.get).toHaveBeenCalledOnce();
  expect(workers).toHaveLength(0);
  await opening;
  expect(device.setSampleRate).toHaveBeenCalledWith(SAMPLE_RATE);
  expect(device.enableBiasTee).toHaveBeenCalledWith(false);
  expect(device.readSamples).toHaveBeenCalledTimes(2);
  await stop(session);
});

it("replaces each completed USB read immediately and preserves request order", async () => {
  const session = new RadioSession();
  await session.connect(defaults);
  const buffer = (id: number) => {
    const data = new ArrayBuffer(131072);
    new Uint8Array(data)[0] = id;
    return { data };
  };
  const first = reads.shift()!;
  first.resolve(buffer(1));
  await vi.waitFor(() => expect(device.readSamples).toHaveBeenCalledTimes(3));
  // The second transfer is still outstanding; waiting for pairs would stall here.
  expect(reads).toHaveLength(2);
  const [second, third] = reads.splice(0);
  third.resolve(buffer(3));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const worker = workers[0];
  const ids = () =>
    worker.messages
      .filter((m) => m.type === "iq")
      .map((m) => new Uint8Array(m.data)[0]);
  expect(ids()).toEqual([1]);
  const processed = {
    type: "processed" as const,
    events: [],
    rms: -10,
    clipping: 0,
    elapsed: 1,
    samples: 65536,
    revision: 1,
  };
  worker.onmessage?.({ data: processed });
  second.resolve(buffer(2));
  await vi.waitFor(() => expect(device.readSamples).toHaveBeenCalledTimes(5));
  expect(ids()).toEqual([1, 2]);
  worker.onmessage?.({ data: processed });
  expect(ids()).toEqual([1, 2, 3]);
  await stop(session);
});

it("drains the remaining USB read before retuning and discards old-frequency buffers", async () => {
  const session = new RadioSession();
  await session.connect(defaults);
  device.setCenterFrequency.mockClear();
  const updating = session.update({
    ...defaults,
    center: 101e6,
    channel: 101.1e6,
  });
  const first = reads.shift()!;
  first.resolve({ data: new ArrayBuffer(131072) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(device.setCenterFrequency).not.toHaveBeenCalled();
  expect(device.readSamples).toHaveBeenCalledTimes(2);
  reads.shift()!.resolve({ data: new ArrayBuffer(131072) });
  await updating;
  expect(device.setCenterFrequency).toHaveBeenCalledWith(101e6);
  expect(workers[0].messages.filter((m) => m.type === "iq")).toHaveLength(0);
  await stop(session);
});

it("serializes tuning and gain writes between fully drained USB read pairs", async () => {
  const session = new RadioSession();
  await session.connect(defaults);
  device.setCenterFrequency.mockClear();
  device.setGain.mockClear();
  const updating = session.update({
    ...defaults,
    center: 101e6,
    channel: 101.1e6,
    gain: 30,
  });
  expect(device.setCenterFrequency).not.toHaveBeenCalled();
  await pair();
  await updating;
  expect(device.setCenterFrequency).toHaveBeenCalledWith(101e6);
  expect(device.setGain).toHaveBeenCalledWith(30);
  expect(
    workers[0].messages.some((m) => m.type === "configure" && m.revision === 2),
  ).toBe(true);
  await stop(session);
});
it("updates the RF center and all NFM virtual receivers in one worker configuration", async () => {
  const windows = captureWindows(starterLibrary().banks[0]);
  const config = (index: number) => ({
    bankId: "frs-gmrs",
    windowKey: windows[index].key,
    presets: windows[index].presets,
    holdId: null,
  });
  const settings = {
    ...defaults,
    decoder: "nfm" as const,
    center: windows[0].center,
    channel: windows[0].presets[0].frequency,
    bandwidth: 12500,
  };
  const session = new RadioSession();
  await session.connect(settings, config(0));
  expect(workers[0].messages[0]).toMatchObject({
    type: "init",
    monitor: config(0),
  });
  const updating = session.update(
    {
      ...settings,
      center: windows[1].center,
      channel: windows[1].presets[0].frequency,
    },
    config(1),
  );
  await pair();
  await updating;
  expect(workers[0].messages.find((m) => m.type === "configure")).toMatchObject(
    { settings: { center: windows[1].center }, monitor: config(1) },
  );
  await stop(session);
});

it("updates ARMER policy without resetting control state and discards old-policy audio", async () => {
  const session = new RadioSession();
  session.onFrame = vi.fn();
  await session.connect({
    ...defaults,
    decoder: "armer",
    center: 852400000,
    channel: 853075000,
    bandwidth: 12500,
  });
  await pair();
  const worker = workers[0];
  const first = worker.messages.find((m) => m.type === "iq")!;
  if (first.type !== "iq") throw Error("Missing IQ block");
  session.setArmerPolicy({ defaultListen: false, rules: [] });
  const policy = worker.messages.find((m) => m.type === "armer-policy")!;
  if (policy.type !== "armer-policy") throw Error("Missing policy update");
  expect(policy.revision).toBeGreaterThan(first.revision);
  expect(worker.messages.filter((m) => m.type === "configure")).toHaveLength(0);
  const frame = {
    type: "processed" as const,
    events: [],
    rms: -10,
    clipping: 0,
    elapsed: 1,
    samples: 65536,
  };
  worker.onmessage?.({ data: { ...frame, revision: first.revision } });
  expect(session.onFrame).not.toHaveBeenCalled();
  const newest = worker.messages.at(-1)!;
  expect(newest).toMatchObject({ type: "iq", revision: policy.revision });
  worker.onmessage?.({ data: { ...frame, revision: policy.revision } });
  expect(session.onFrame).toHaveBeenCalledOnce();
  await stop(session);
});

it("waits for reads before closing USB, then supports reconnecting", async () => {
  const session = new RadioSession();
  await session.connect(defaults);
  const stopping = session.stop();
  expect(device.close).not.toHaveBeenCalled();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  await pair();
  await stopping;
  expect(device.close).toHaveBeenCalledOnce();
  await session.connect(defaults);
  expect(workers).toHaveLength(2);
  await stop(session);
});

it("stops on worker overload instead of silently dropping IQ continuity", async () => {
  const session = new RadioSession();
  session.onError = vi.fn();
  await session.connect(defaults);
  for (let i = 0; i < 7; i++) await pair();
  expect(session.onError).toHaveBeenCalledWith(
    expect.stringContaining("hidden sample gaps"),
  );
  await stop(session);
  expect(device.close).toHaveBeenCalledOnce();
});

it("drains both reads on unplug and reports an actionable error", async () => {
  const session = new RadioSession();
  session.onError = vi.fn();
  await session.connect(defaults);
  const [first, second] = reads.splice(0);
  first.reject(Error("USB transfer failed"));
  await Promise.resolve();
  expect(device.close).not.toHaveBeenCalled();
  second.reject(Error("USB disconnected"));
  await vi.waitFor(() => expect(session.onError).toHaveBeenCalledOnce());
  await session.stop();
  expect(device.close).toHaveBeenCalledOnce();
});

it("releases the receiver when initialization fails and rejects invalid settings before USB", async () => {
  const session = new RadioSession();
  await expect(session.connect({ ...defaults, span: 5e6 })).rejects.toThrow(
    /Displayed bandwidth/,
  );
  expect(mocks.get).not.toHaveBeenCalled();
  device.setSampleRate.mockRejectedValueOnce(Error("Sample rate failed"));
  await expect(session.connect(defaults)).rejects.toThrow(/Sample rate failed/);
  expect(device.close).toHaveBeenCalledOnce();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});

it("records returned IQ even across policy revisions, excludes stale capture IDs, and finalizes before tuning", async () => {
  const { downloadSink } = await import("./recording/storage");
  const session = new RadioSession();
  const states: import("./recording/model").RecordingState[] = [];
  session.onRecording = (state) => states.push(state);
  await session.connect({ ...defaults, decoder: "armer", bandwidth: 12500 });
  session.startRecording(downloadSink("test.cu8"), 0);
  const worker = workers[0];
  const command = worker.messages.find((m) => m.type === "recording" && m.id)!;
  if (command.type !== "recording") throw Error("Missing capture command");
  session.setArmerPolicy({ defaultListen: false, rules: [] });
  const frame = {
    type: "processed" as const,
    events: [],
    rms: -10,
    clipping: 0,
    elapsed: 1,
    samples: 2,
    revision: 0,
  };
  worker.onmessage?.({
    data: {
      ...frame,
      recording: { id: command.id, data: new Uint8Array([1, 2, 3, 4]).buffer },
    },
  });
  await session.stopRecording();
  const result = states.at(-1)!;
  expect(result.bytes).toBe(4);
  expect(new Uint8Array(await result.blob!.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3, 4]),
  );
  session.startRecording(downloadSink("second.cu8"), 0);
  worker.onmessage?.({
    data: {
      ...frame,
      recording: { id: command.id, data: new Uint8Array([9, 9]).buffer },
    },
  });
  const next = worker.messages
    .filter((m) => m.type === "recording" && m.id)
    .at(-1)!;
  if (next.type !== "recording") throw Error("Missing capture command");
  worker.onmessage?.({
    data: {
      ...frame,
      recording: { id: next.id, data: new Uint8Array([5, 6]).buffer },
    },
  });
  const updating = session.update({
    ...defaults,
    center: 101e6,
    channel: 101.1e6,
  });
  await vi.waitFor(() => expect(states.at(-1)?.phase).toBe("complete"));
  expect(states.at(-1)?.bytes).toBe(2);
  expect(states.at(-1)?.info?.settings.center).toBe(defaults.center);
  expect(states.at(-1)?.reason).toContain("configuration changed");
  await pair();
  await updating;
  session.startRecording(downloadSink("third.cu8"), 0);
  await stop(session);
  expect(states.at(-1)?.phase).toBe("complete");
  expect(states.at(-1)?.reason).toBe("Receiver stopped");
});
