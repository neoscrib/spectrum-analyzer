import { describe, it, expect } from "vitest";
import {
  headerPrefix,
  parseSame,
  parseLocation,
  matchesLocation,
} from "./parse";
import { SameHistory, matchesFilters } from "./history";
import { TEST_HEADER, NWS_REFERENCE_HEADER } from "./fixtures";
import type { SameBatch, SameNativeEvent } from "./model";
const reference = new Date("2026-11-24T18:30:00Z");
const batch = (...events: SameNativeEvent[]): SameBatch => ({
  stream: "nfm@162425000",
  frequency: 162425000,
  sampleRate: 24000,
  sourceSeconds: 0,
  processingMs: 0,
  events,
});
describe("SAME metadata and verification", () => {
  it("parses the published NWS Appendix A.3.2 vector", () => {
    const h = parseSame(NWS_REFERENCE_HEADER, new Date("2005-06-08T18:30Z"));
    expect(h.locations.map((l) => l.county)).toEqual([
      "Wood County",
      "Fulton County",
      "Henry County",
    ]);
    expect(h.locations[2].subdivision).toBe("Northwest");
    expect(h.issued).toBe("2005-06-08T18:29:00.000Z");
    expect(h.expires).toBe("2005-06-08T18:59:00.000Z");
  });
  it("parses all transmitted fields, multiple areas and geographic subdivisions", () => {
    const h = parseSame(TEST_HEADER, reference);
    expect(h.eventName).toBe("Required Weekly Test");
    expect(h.category).toBe("test");
    expect(h.originatorName).toBe("National Weather Service");
    expect(h.sender).toBe("TEST    ");
    expect(h.locations.map((l) => l.county)).toEqual([
      "Kanabec County",
      "Mille Lacs County",
    ]);
    expect(h.issued).toBe("2026-11-24T18:30:00.000Z");
    expect(h.expires).toBe("2026-11-24T19:00:00.000Z");
    expect(parseLocation("127065").name).toContain("Northwest");
  });
  it("retains unknown codes without invented severity or place names", () => {
    const h = parseSame(
      TEST_HEADER.replace("-RWT-", "-XYW-").replace("027065", "099999"),
      reference,
    );
    expect(h.event).toBe("XYW");
    expect(h.category).toBe("unknown");
    expect(h.locations[0].known).toBe(false);
    expect(h.locations[0].code).toBe("099999");
    expect(parseLocation("000000").name).toBe("Nationwide");
    expect(parseLocation("027000").name).toContain("Entire Minnesota");
  });
  it("infers the nearest valid year and expires across midnight/year boundaries", () => {
    const h = parseSame(
      TEST_HEADER.replace("3281830", "3652350"),
      new Date("2027-01-01T00:01:00Z"),
    );
    expect(h.issued).toBe("2026-12-31T23:50:00.000Z");
    expect(h.expires).toBe("2027-01-01T00:20:00.000Z");
    expect(() =>
      parseSame(TEST_HEADER.replace("3281830", "3661830"), reference),
    ).toThrow();
    expect(
      parseSame(
        TEST_HEADER.replace("3281830", "3661830"),
        new Date("2025-01-01T00:00Z"),
      ).inferredYear,
    ).toBe(2024);
  });
  it.each([
    TEST_HEADER.slice(0, -1),
    TEST_HEADER.replace("+0030", "+0010"),
    TEST_HEADER.replace("+0030", "+0160"),
    TEST_HEADER.replace("3281830", "0001830"),
    TEST_HEADER.replace("3281830", "3282460"),
    "ZCZC-WXR-TOR-027065",
    "ordinary speech",
  ])("rejects malformed or incomplete fields: %s", (raw) =>
    expect(() => parseSame(raw, reference)).toThrow(),
  );
  it("recognizes a complete header before carrier-loss noise, preserving raw evidence", () => {
    const history = new SameHistory();
    history.ingest(
      batch({
        kind: "burst",
        raw: TEST_HEADER + "\0\0",
        bytes: [],
        seconds: 2,
      }),
      reference,
    );
    expect(headerPrefix(TEST_HEADER + "noise")).toBe(TEST_HEADER);
    expect(history.records[0].header?.raw).toBe(TEST_HEADER);
    expect(history.records[0].raw).toEqual([TEST_HEADER + "\0\0"]);
    expect(history.records[0].verification).toBe("single");
  });
  it("coalesces repetitions, distinguishes agreement/recovery and terminates the latest stream message", () => {
    const history = new SameHistory();
    for (let n = 0; n < 3; n++)
      history.ingest(
        batch({ kind: "burst", raw: TEST_HEADER, bytes: [], seconds: n * 2 }),
        reference,
      );
    history.ingest(
      batch({
        kind: "message",
        raw: TEST_HEADER,
        voted: TEST_HEADER.length,
        errors: 0,
        seconds: 7,
      }),
      reference,
    );
    expect(history.records).toHaveLength(1);
    expect(history.records[0].observations).toBe(3);
    expect(history.records[0].verification).toBe("agreed");
    history.ingest(
      batch(
        { kind: "burst", raw: "NNNNfff", bytes: [], seconds: 10 },
        { kind: "message", raw: "NNNN", voted: 0, errors: 0, seconds: 11 },
      ),
      reference,
    );
    expect(history.records).toHaveLength(2);
    expect(history.records.find((r) => r.header)?.ended).toBe(
      reference.toISOString(),
    );
    const recovered = new SameHistory();
    for (const [n, c] of ["X", "Y", "Z"].entries())
      recovered.ingest(
        batch({
          kind: "burst",
          raw: TEST_HEADER.replace("027065", `0270${c}5`),
          bytes: [],
          seconds: n * 2,
        }),
        reference,
      );
    recovered.ingest(
      batch({
        kind: "message",
        raw: TEST_HEADER,
        voted: 3,
        errors: 3,
        seconds: 7,
      }),
      reference,
    );
    expect(recovered.records).toHaveLength(1);
    expect(recovered.records[0].verification).toBe("recovered");
    expect(recovered.records[0].raw).toHaveLength(3);
  });
  it("preserves distinct consecutive alerts, retransmissions and bounded history", () => {
    const history = new SameHistory();
    history.ingest(
      batch({ kind: "burst", raw: TEST_HEADER, bytes: [], seconds: 0 }),
      reference,
    );
    history.ingest(
      batch({ kind: "burst", raw: TEST_HEADER, bytes: [], seconds: 40 }),
      new Date(reference.getTime() + 40000),
    );
    expect(history.records[0].retransmissions).toBe(1);
    history.ingest(
      batch({
        kind: "burst",
        raw: TEST_HEADER.replace("RWT", "TOR"),
        bytes: [],
        seconds: 41,
      }),
      reference,
    );
    expect(history.records).toHaveLength(2);
    for (let n = 0; n < 400; n++)
      history.ingest(
        batch({ kind: "rejected", reason: String(n), seconds: n }),
        reference,
      );
    expect(history.records).toHaveLength(200);
  });
  it("filters geographic/event matches without changing retained raw records", () => {
    expect(matchesLocation("027000", "027065")).toBe(true);
    expect(matchesLocation("000000", "027065")).toBe(true);
    expect(matchesLocation("127065", "027065")).toBe(true);
    expect(matchesLocation("127065", "227065")).toBe(false);
    const history = new SameHistory();
    history.ingest(
      batch({ kind: "burst", raw: TEST_HEADER, bytes: [], seconds: 0 }),
      reference,
    );
    expect(matchesFilters(history.records[0], ["027065"], ["RWT"])).toBe(true);
    expect(matchesFilters(history.records[0], ["027001"], [])).toBe(false);
    expect(history.records[0].raw[0]).toBe(TEST_HEADER);
  });
});
