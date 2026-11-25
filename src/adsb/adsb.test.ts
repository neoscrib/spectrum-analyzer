import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import createAdsb, { type AdsbModule } from "../wasm-adsb/adsb";
import { adsbDefaults, field, type ModeSFrame, type Cpr } from "./model";
import { AircraftTracker, type CprResolver } from "./tracker";
import {
  KNOWN_FRAMES,
  bits,
  crc,
  frame,
  identification,
  positionFrame,
  velocityFrame,
  withParity,
} from "./fixtures";
import { inspectCu8Replay } from "../recording/replay";
import { defaults, validateSettings } from "../model";
let native: AdsbModule, p: number, resolve: CprResolver;
function parse(hex: string, at = 1) {
  native.HEAPU8.set(Buffer.from(hex, "hex"), p);
  native._adsb_frame(p, hex.length / 2, at);
  return (
    JSON.parse(native.UTF8ToString(native._adsb_take())) as ModeSFrame[]
  )[0];
}
beforeAll(async () => {
  native = await createAdsb({
    wasmBinary: await readFile(
      new URL("../wasm-adsb/adsb.wasm", import.meta.url),
    ),
  });
  native._adsb_init(1);
  p = native._malloc(131072);
  resolve = (type, ref, even, odd, useOdd) =>
    JSON.parse(
      native.UTF8ToString(
        native._adsb_cpr(
          type,
          ref.lat,
          ref.lon,
          even.lat,
          even.lon,
          odd.lat,
          odd.lon,
          useOdd ? 1 : 0,
          even.surface ? 1 : 0,
        ),
      ),
    );
});
describe("Mode S parser and parity", () => {
  it("decodes published identification, altitude and velocity vectors", () => {
    expect(parse(KNOWN_FRAMES[0]).callsign?.trim()).toBe("KLM1023");
    expect(parse(KNOWN_FRAMES[1]).baroAltitude).toBe(38000);
    const v = parse(KNOWN_FRAMES[3]);
    expect(v.groundSpeed).toBeCloseTo(159.2, 1);
    expect(v.heading).toBeCloseTo(182.88, 1);
    expect(v.gnssRate).toBe(-832);
    for (const h of KNOWN_FRAMES) expect(crc(Buffer.from(h, "hex"))).toBe(0);
  });
  it("checks 56-bit DF11 PI with nonzero interrogator and AP against verified ICAO cache", () => {
    const id = 0x40621d;
    parse(KNOWN_FRAMES[1]);
    const df11 = withParity(
      Uint8Array.from([0x5d, 0x40, 0x62, 0x1d, 0, 0, 0]),
      37,
    );
    expect(parse(df11).df).toBe(11);
    expect(parse(df11).syndrome).toBe(37);
    const ap = withParity(Uint8Array.from([0x20, 0, 0, 0, 0, 0, 0]), id);
    expect(parse(ap).address).toBe("40621D");
    expect(crc(Buffer.from(ap, "hex"))).toBe(id);
    const unknown = withParity(
      Uint8Array.from([0x20, 0, 0, 0, 0, 0, 0]),
      0xabcdef,
    );
    expect(parse(unknown)).toBeUndefined();
  });
  it("separates clean frames, conservative one-bit corrections and uncorrectable damage", () => {
    const clean = identification(0xabc123, "TEST123");
    parse(clean);
    const b = Buffer.from(clean, "hex");
    b[6] ^= 4;
    const repaired = parse(b.toString("hex"));
    expect(repaired.corrected).toBe(1);
    expect(repaired.hex).toBe(clean);
    expect(repaired.original).not.toBe(clean);
    b[7] ^= 8;
    expect(parse(b.toString("hex"))).toBeUndefined();
    const unknown = Buffer.from(identification(0xaabbcc, "UNKNOWN"), "hex");
    unknown[6] ^= 4;
    expect(parse(unknown.toString("hex"))).toBeUndefined();
  });
  it("decodes applicable DF18 and preserves non-ICAO identities distinctly", () => {
    const me = Buffer.from(
      identification(0x123456, "NONTRANS"),
      "hex",
    ).subarray(4, 11);
    const nt = parse(frame(0x123456, me, 18, 0));
    expect(nt.df).toBe(18);
    expect(nt.callsign).toBe("NONTRANS");
    expect(nt.icao).toBe(true);
    const other = parse(frame(0x123456, me, 18, 1));
    expect(other.icao).toBe(false);
    const tracker = new AircraftTracker(adsbDefaults, resolve);
    tracker.ingest(nt);
    tracker.ingest(other);
    expect(tracker.snapshot(1)).toHaveLength(2);
  });
  it("preserves unsupported type codes as raw frames without position", () => {
    const me = new Uint8Array(7);
    bits(me, 1, 5, 30);
    const m = parse(frame(0x123456, me));
    expect(m.typeCode).toBe(30);
    expect(m.hex).toHaveLength(28);
    expect(m.cpr).toBeUndefined();
  });
  it("decodes emergency, squawk, GNSS altitude and airspeed status when transmitted", () => {
    const status = new Uint8Array(7);
    bits(status, 1, 5, 28);
    bits(status, 6, 8, 1);
    bits(status, 9, 11, 1);
    bits(status, 12, 24, 0x1555);
    const m = parse(frame(0x123456, status));
    expect(m.emergency).toBe(1);
    expect(m.squawk).toMatch(/^\d{4}$/);
    const gnss = Buffer.from(
      positionFrame(0x123456, 45.5462, -93, false),
      "hex",
    );
    bits(gnss, 33, 37, 20);
    gnss.fill(0, 11);
    expect(parse(withParity(gnss)).gnssAltitude).toBe(12000);
    const velocity = new Uint8Array(7);
    bits(velocity, 1, 5, 19);
    bits(velocity, 6, 8, 3);
    bits(velocity, 14, 14, 1);
    bits(velocity, 15, 24, 256);
    bits(velocity, 26, 35, 201);
    const v = parse(frame(0x123456, velocity));
    expect(v.ias).toBe(200);
    expect(v.heading).toBe(90);
  });
});
describe("CPR tracking and freshness", () => {
  it("globally resolves the published pair without receiver coordinates", () => {
    const t = new AircraftTracker(adsbDefaults, resolve);
    t.ingest(parse(KNOWN_FRAMES[1], 1));
    expect(t.snapshot(1)[0].position).toBeUndefined();
    t.ingest(parse(KNOWN_FRAMES[2], 2));
    const pos = t.snapshot(2)[0].position!;
    expect(pos.lat).toBeCloseTo(52.26578, 4);
    expect(pos.lon).toBeCloseTo(3.93891, 4);
    expect(pos.method).toBe("global");
  });
  it("rejects old, incompatible and interrupted pairs", () => {
    const t = new AircraftTracker(adsbDefaults, resolve);
    t.ingest(parse(KNOWN_FRAMES[1], 1));
    t.ingest(parse(KNOWN_FRAMES[2], 12));
    expect(t.snapshot(12)[0].position).toBeUndefined();
    t.resetPositions();
    t.ingest(parse(KNOWN_FRAMES[1], 13));
    expect(t.snapshot(13)[0].position).toBeUndefined();
  });
  it("supports opt-in receiver-local and recent-aircraft local CPR", () => {
    const receiver = { lat: 52.25, lon: 3.9 };
    const t = new AircraftTracker(
      { ...adsbDefaults, receiver, localCpr: true },
      resolve,
    );
    t.ingest(parse(KNOWN_FRAMES[1], 1));
    expect(t.snapshot(1)[0].position?.method).toBe("local-receiver");
    const global = new AircraftTracker(adsbDefaults, resolve);
    global.ingest(parse(KNOWN_FRAMES[1], 1));
    global.ingest(parse(KNOWN_FRAMES[2], 2));
    global.ingest(parse(KNOWN_FRAMES[2], 14));
    expect(global.snapshot(14)[0].position?.method).toBe("local-aircraft");
  });
  it("resolves surface pairs near a reference, leaving unreferenced surface data unavailable", () => {
    const t = new AircraftTracker(
        { ...adsbDefaults, receiver: { lat: 45.9, lon: -93.3 } },
        resolve,
      ),
      noRef = new AircraftTracker(adsbDefaults, resolve);
    for (const [at, odd] of [
      [1, false],
      [2, true],
    ] as const) {
      const m = parse(positionFrame(0x123456, 45.91, -93.31, odd, true), at);
      t.ingest(m);
      noRef.ingest(m);
    }
    expect(t.snapshot(2)[0].position?.lat).toBeCloseTo(45.91, 3);
    expect(t.snapshot(2)[0].position?.method).toBe("surface-pair");
    expect(noRef.snapshot(2)[0].position).toBeUndefined();
  });
  it("uses recent local CPR across a latitude-zone boundary and rejects mixed sources", () => {
    const t = new AircraftTracker(adsbDefaults, resolve);
    t.ingest(parse(positionFrame(0x998877, 10.4703, 20, false), 1));
    t.ingest(parse(positionFrame(0x998877, 10.4703, 20, true), 2));
    t.ingest(parse(positionFrame(0x998877, 10.4707, 20, true), 3));
    expect(t.snapshot(3)[0].position?.lat).toBeCloseTo(10.4707, 3);
    const mixed = new AircraftTracker(adsbDefaults, resolve);
    mixed.ingest(parse(KNOWN_FRAMES[1], 1));
    mixed.ingest({ ...parse(KNOWN_FRAMES[2], 2), source: 5 });
    expect(mixed.snapshot(2)[0].position).toBeUndefined();
  });
  it("bounds trails and raw frames and reacquires expired identities", () => {
    const t = new AircraftTracker(adsbDefaults, resolve);
    for (let seconds = 1; seconds < 700; seconds++)
      t.ingest(
        parse(positionFrame(0x889977, 45.9, -93.3, seconds % 2 === 1), seconds),
      );
    const a = t.snapshot(700)[0];
    expect(a.trail.length).toBeLessThanOrEqual(120);
    expect(a.recent).toHaveLength(12);
    t.expire(1100);
    expect(t.snapshot(1100)).toHaveLength(0);
    t.ingest(parse(identification(0x889977, "REAPPEAR"), 1101));
    expect(t.snapshot(1101)[0].messages).toBe(1);
    expect(t.snapshot(1101)[0].position).toBeUndefined();
  });
  it("rejects implausible jumps and out-of-range receiver solutions", () => {
    const t = new AircraftTracker(adsbDefaults, resolve);
    t.ingest(parse(positionFrame(0x123456, 45.9, -93.3, false), 1));
    t.ingest(parse(positionFrame(0x123456, 45.9, -93.3, true), 2));
    t.ingest(parse(positionFrame(0x123456, 30, -80, false), 3));
    t.ingest(parse(positionFrame(0x123456, 30, -80, true), 4));
    expect(t.snapshot(4)[0].position?.lat).toBeCloseTo(45.9, 3);
    expect(t.rejected).toBeGreaterThan(0);
    const far = new AircraftTracker(
      { ...adsbDefaults, receiver: { lat: 0, lon: 0 } },
      resolve,
    );
    far.ingest(parse(KNOWN_FRAMES[1], 1));
    far.ingest(parse(KNOWN_FRAMES[2], 2));
    expect(far.snapshot(2)[0].position).toBeUndefined();
  });
  it("bounds registry, trails and recent frames and tracks freshness per field", () => {
    const t = new AircraftTracker(adsbDefaults, resolve);
    const id = parse(identification(0x123456, "FRESH"), 1);
    t.ingest(id);
    t.ingest(parse(velocityFrame(0x123456), 2));
    const a = t.snapshot(3)[0];
    expect(field(a, "callsign", 50)).toBe("FRESH   ");
    expect(field(a, "groundSpeed", 50)).toBeUndefined();
    for (let n = 0; n < 700; n++)
      t.ingest({ ...id, address: n.toString(16).padStart(6, "0"), seconds: 3 });
    expect(t.snapshot(3).length).toBeLessThanOrEqual(512);
    expect(t.evicted).toBeGreaterThan(0);
    expect(t.snapshot(64)).toHaveLength(0);
    t.expire(310);
    expect(t.snapshot(310)).toHaveLength(0);
  });
  it("rejects mismatched latitude zones in the native resolver", () => {
    const a = parse(positionFrame(0x123456, 45.5462, -93, false)).cpr!,
      b = parse(positionFrame(0x123456, 45.5463, -93, true)).cpr!;
    expect(resolve(0, { lat: 0, lon: 0 }, a, b, true)).toBeNull();
  });
});
describe("shared IQ replay and settings", () => {
  it("imports fixed-rate SigMF without guessing capture year or changing frequency", async () => {
    const iq = new File([new Uint8Array(4096)], "capture.sigmf-data"),
      meta = new File(
        [
          JSON.stringify({
            global: { "core:datatype": "cu8", "core:sample_rate": 2400000 },
            captures: [
              {
                "core:sample_start": 0,
                "core:frequency": 1090000000,
                "core:datetime": "2020-01-02T03:04:05Z",
              },
            ],
          }),
        ],
        "capture.sigmf-meta",
      );
    const r = await inspectCu8Replay(iq, meta, defaults);
    expect(r.source.referenceTime).toBe("2020-01-02T03:04:05.000Z");
    expect(r.source.center).toBe(1090000000);
  });
  it("rejects mismatched rate, multiple captures and malformed IQ", async () => {
    const iq = new File([new Uint8Array(4096)], "iq");
    for (const global of [
      { "core:datatype": "cu8", "core:sample_rate": 2000000 },
      { "core:datatype": "cs16", "core:sample_rate": 2400000 },
    ])
      await expect(
        inspectCu8Replay(
          iq,
          new File([JSON.stringify({ global })], "meta"),
          defaults,
        ),
      ).rejects.toThrow();
    await expect(
      inspectCu8Replay(
        new File([new Uint8Array(3)], "iq"),
        undefined,
        defaults,
      ),
    ).rejects.toThrow();
  });
  it("validates options and full-rate capture compatibility", () => {
    expect(() =>
      validateSettings({
        ...defaults,
        decoder: "adsb",
        center: 1090000000,
        channel: 1090000000,
        bandwidth: 2000000,
      }),
    ).not.toThrow();
    expect(() =>
      validateSettings({
        ...defaults,
        adsb: { ...adsbDefaults, receiver: { lat: NaN, lon: 0 } },
      }),
    ).toThrow();
  });
});
