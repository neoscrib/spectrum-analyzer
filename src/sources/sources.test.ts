import { afterEach, expect, it, vi } from "vitest";
import { openHackrf } from "./hackrf";
import { BridgeConnection } from "./soapy";
import {
  defaultSource,
  sourceDefaults,
  validateReceiver,
  validateSourceDecoder,
} from "./model";
import { defaults } from "../model";
import { captureMetadata } from "../recording/model";
afterEach(() => vi.unstubAllGlobals());
function hackrf() {
  const commands: {
    direction: string;
    request: number;
    value: number;
    index: number;
    bytes: Uint8Array;
  }[] = [];
  const device = {
    opened: false,
    configuration: null as null | { configurationValue: number },
    productName: "HackRF One",
    open: vi.fn(async () => {
      device.opened = true;
    }),
    selectConfiguration: vi.fn(async (n: number) => {
      device.configuration = { configurationValue: n };
    }),
    claimInterface: vi.fn(async () => {}),
    releaseInterface: vi.fn(async () => {}),
    close: vi.fn(async () => {
      device.opened = false;
    }),
    controlTransferOut: vi.fn(async (s, data?: ArrayBuffer) => {
      commands.push({
        direction: "out",
        ...s,
        bytes: new Uint8Array(data ?? new ArrayBuffer(0)).slice(),
      });
      return { status: "ok", bytesWritten: data?.byteLength ?? 0 };
    }),
    controlTransferIn: vi.fn(async (s) => {
      commands.push({ direction: "in", ...s, bytes: new Uint8Array(0) });
      return { status: "ok", data: new DataView(new Uint8Array([1]).buffer) };
    }),
    transferIn: vi.fn(async (_endpoint, size: number) => ({
      status: "ok",
      data: new DataView(
        Uint8Array.from({ length: size }, (_, i) => i % 256).buffer,
      ),
    })),
  };
  const usb = { requestDevice: vi.fn(async () => device) };
  return { device, commands, usb: usb as unknown as USB };
}
it("configures HackRF receive requests and converts every signed 8-bit value exactly", async () => {
  const { device, commands, usb } = hackrf();
  const source = await openHackrf(usb);
  await source.configure({ center: 5123456789, gain: 26, ppm: 0 });
  const rate = commands.find((c) => c.request === 6)!.bytes;
  expect(new DataView(rate.buffer).getUint32(0, true)).toBe(2400000);
  expect(new DataView(rate.buffer).getUint32(4, true)).toBe(1);
  const tune = commands.find((c) => c.request === 16)!.bytes;
  expect(new DataView(tune.buffer).getUint32(0, true)).toBe(5123);
  expect(new DataView(tune.buffer).getUint32(4, true)).toBe(456789);
  expect(
    commands
      .filter((c) => c.direction === "in")
      .map((c) => [c.request, c.index]),
  ).toEqual([
    [19, 24],
    [20, 2],
  ]);
  expect(commands.filter((c) => c.request === 1).map((c) => c.value)).toEqual([
    0, 1,
  ]);
  expect(
    commands
      .filter((c) => c.request === 17 || c.request === 23)
      .every((c) => c.value === 0),
  ).toBe(true);
  const data = new Uint8Array((await source.readSamples(128)).data);
  expect([...data]).toEqual(
    Array.from({ length: 256 }, (_, i) => (i + 128) % 256),
  );
  await source.close();
  await source.close();
  expect(commands.filter((c) => c.request === 1).map((c) => c.value)).toEqual([
    0, 1, 0,
  ]);
  expect(device.close).toHaveBeenCalledOnce();
});
it("rejects unsupported controls, failed gain requests and short HackRF samples", async () => {
  const { device, usb } = hackrf();
  const source = await openHackrf(usb);
  await expect(
    source.configure({ center: 100e6, gain: null, ppm: 0 }),
  ).rejects.toThrow(/gain/);
  await expect(
    source.configure({ center: 100e6, gain: 24, ppm: 1 }),
  ).rejects.toThrow(/PPM/);
  device.controlTransferIn.mockResolvedValueOnce({
    status: "ok",
    data: new DataView(new Uint8Array([0]).buffer),
  });
  await expect(
    source.configure({ center: 100e6, gain: 24, ppm: 0 }),
  ).rejects.toThrow(/rejected/);
  device.transferIn.mockResolvedValueOnce({
    status: "ok",
    data: new DataView(new ArrayBuffer(2)),
  });
  await expect(source.readSamples(128)).rejects.toThrow(/short block/);
  await source.close();
});
it("validates actual hardware ranges independently of normalized decoder sample rate", () => {
  const hf = {
    ...sourceDefaults("soapy"),
    nativeRate: 768000,
    minHz: 500000,
    maxHz: 31e6,
    frequencyRanges: [
      [500000, 31e6],
      [60e6, 260e6],
    ] as [number, number][],
  };
  expect(() =>
    validateReceiver({ center: 40e6, gain: 20, ppm: 0 }, hf),
  ).toThrow(/tuning range/);
  expect(() =>
    validateSourceDecoder(
      {
        ...defaults,
        center: 25e6,
        channel: 25e6,
        decoder: "am",
        bandwidth: 10000,
      },
      hf,
    ),
  ).not.toThrow();
  expect(() =>
    validateSourceDecoder(
      {
        ...defaults,
        center: 25e6,
        channel: 25.5e6,
        decoder: "am",
        bandwidth: 10000,
      },
      hf,
    ),
  ).toThrow(/capture/);
  expect(() =>
    validateSourceDecoder(
      {
        ...defaults,
        center: 100e6,
        channel: 100e6,
        decoder: "armer",
        bandwidth: 12500,
      },
      hf,
    ),
  ).toThrow(/2.4 MSPS/);
});
it("records source identity, original format/rate and conversion without claiming native high-bit-depth IQ", () => {
  const receiver = {
    ...sourceDefaults("soapy"),
    name: "Airspy",
    nativeRate: 6e6,
  };
  const global = JSON.parse(
    captureMetadata(
      {
        filename: "radio.cu8",
        settings: defaults,
        source: "live",
        startedAt: "2026-11-25T00:00:00Z",
        receiver,
      },
      4800000,
      "stop",
    ),
  ).global;
  expect(global["core:hw"]).toBe("Airspy (WebSocket)");
  expect(global["spectrum:receiver"].nativeRate).toBe(6e6);
  expect(global["core:datatype"]).toBe("cu8");
  expect(global["core:description"]).toContain("8-bit quantization");
});

class FakeSocket {
  static last: FakeSocket;
  onopen?: () => void;
  onerror?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  binaryType = "";
  close = vi.fn();
  send = vi.fn((raw: string) => {
    const { id, type } = JSON.parse(raw);
    queueMicrotask(() =>
      this.onmessage?.({
        data: JSON.stringify({
          id,
          type: "result",
          result:
            type === "configure"
              ? { generation: 1, info: sourceDefaults("soapy") }
              : {},
        }),
      }),
    );
  });
  constructor() {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.());
  }
  iq(sequence: number, generation = 1) {
    const data = new ArrayBuffer(20),
      h = new DataView(data);
    h.setUint32(0, 0x53495131, false);
    h.setUint32(4, sequence, true);
    h.setUint32(8, 2, true);
    h.setUint32(12, generation, true);
    new Uint8Array(data, 16).set([1, 2, 3, 4]);
    this.onmessage?.({ data });
  }
}
it("rejects bridge sequence gaps, ignores old retune generations and resolves pending reads on disconnect", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  const connection = new BridgeConnection({ ...defaultSource, kind: "soapy" });
  await connection.configure({ center: 100e6, gain: 20, ppm: 0 });
  const first = connection.readSamples();
  FakeSocket.last.iq(99, 0); // Discard old-frequency data.
  FakeSocket.last.iq(0);
  expect([...new Uint8Array((await first).data)]).toEqual([1, 2, 3, 4]);
  const next = connection.readSamples();
  const rejected = expect(next).rejects.toThrow(/sequence gap/);
  FakeSocket.last.iq(2);
  await rejected;
  await expect(connection.readSamples()).rejects.toThrow(/sequence gap/);
  expect(FakeSocket.last.close).toHaveBeenCalled();
});
it("stops a bounded bridge queue instead of silently dropping IQ", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  const connection = new BridgeConnection({ ...defaultSource, kind: "soapy" });
  await connection.configure({ center: 100e6, gain: 20, ppm: 0 });
  for (let i = 0; i < 9; i++) FakeSocket.last.iq(i);
  await expect(connection.readSamples()).rejects.toThrow(/overflow/);
});
