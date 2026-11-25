import {
  distanceBearing,
  field,
  type AdsbOptions,
  type Aircraft,
  type Cpr,
  type ModeSFrame,
  type Position,
} from "./model";
export type CprResolver = (
  type: number,
  reference: { lat: number; lon: number },
  even: Cpr,
  odd: Cpr,
  useOdd: boolean,
) => [number, number] | null;
interface Entry {
  aircraft: Aircraft;
  even?: { cpr: Cpr; at: number; source: number };
  odd?: { cpr: Cpr; at: number; source: number };
}
/** Worker-owned registry. No UI object aliases; snapshots are posted at 2 Hz.
 * Source sample time, never processing wall time, drives CPR and field freshness. */
export class AircraftTracker {
  private entries = new Map<string, Entry>();
  evicted = 0;
  rejected = 0;
  constructor(
    private options: AdsbOptions,
    private resolve: CprResolver,
  ) {}
  resetPositions() {
    for (const e of this.entries.values()) {
      e.even = undefined;
      e.odd = undefined;
      e.aircraft.position = undefined;
      e.aircraft.trail = [];
    }
  }
  ingest(m: ModeSFrame) {
    // Non-ICAO and rebroadcast addresses must not collide with ICAO transponders.
    const id = m.icao
      ? `icao:${m.address}`
      : `other:${m.addressType}:${m.address}`;
    let e = this.entries.get(id);
    if (!e) {
      this.expire(m.seconds);
      if (this.entries.size >= 512) {
        let oldest = this.entries.keys().next().value!;
        for (const [id, entry] of this.entries)
          if (
            entry.aircraft.lastSeen <
            this.entries.get(oldest)!.aircraft.lastSeen
          )
            oldest = id;
        this.entries.delete(oldest);
        this.evicted++;
      }
      e = {
        aircraft: {
          id,
          address: m.address,
          icao: m.icao,
          addressType: m.addressType,
          source: m.source,
          firstSeen: m.seconds,
          lastSeen: m.seconds,
          messages: 0,
          corrected: 0,
          signal: m.signal,
          fields: {},
          trail: [],
          recent: [],
          positionRejected: 0,
        },
      };
      this.entries.set(id, e);
    }
    const a = e.aircraft;
    if (m.seconds < a.lastSeen) return;
    a.lastSeen = m.seconds;
    a.messages++;
    a.corrected += m.corrected > 0 ? 1 : 0;
    a.signal = m.signal;
    const assign = <K extends keyof ModeSFrame>(k: K) => {
      if (m[k] !== undefined)
        Object.assign(a.fields, { [k]: { value: m[k], at: m.seconds } });
    };
    for (const key of [
      "callsign",
      "baroAltitude",
      "gnssAltitude",
      "groundSpeed",
      "ias",
      "tas",
      "heading",
      "headingType",
      "baroRate",
      "gnssRate",
      "squawk",
      "emergency",
      "category",
      "version",
      "ident",
      "nacp",
      "selectedAltitude",
      "qnh",
      "airground",
    ] as const)
      assign(key);
    if (
      m.cpr?.surface &&
      m.surfaceSpeedV2 !== undefined &&
      (field(a, "version", m.seconds) ?? 0) >= 2
    )
      a.fields.groundSpeed = { value: m.surfaceSpeedV2, at: m.seconds };
    a.recent.push(m);
    if (a.recent.length > 12) a.recent.shift();
    if (m.cpr && m.cpr.type !== 2) this.position(e, m);
  }
  private position(e: Entry, m: ModeSFrame) {
    const c = m.cpr!;
    const a = e.aircraft;
    const at = m.seconds;
    if (c.odd) e.odd = { cpr: c, at, source: m.source };
    else e.even = { cpr: c, at, source: m.source };
    const previous = a.position;
    const prior =
      previous && at - previous.at <= 30 && previous.surface === c.surface
        ? previous
        : null;
    const receiver = this.options.receiver;
    const ref = prior ?? receiver;
    let xy: [number, number] | null = null,
      method: Position["method"] = "global";
    if (
      e.even &&
      e.odd &&
      e.even.cpr.surface === c.surface &&
      e.odd.cpr.surface === c.surface &&
      e.even.source === e.odd.source &&
      Math.abs(e.even.at - e.odd.at) <= (c.surface ? 25 : 10)
    ) {
      if (!c.surface)
        xy = this.resolve(0, { lat: 0, lon: 0 }, e.even.cpr, e.odd.cpr, c.odd);
      else if (ref) {
        xy = this.resolve(1, ref, e.even.cpr, e.odd.cpr, c.odd);
        method = "surface-pair";
      }
    }
    // Single-frame receiver-relative resolution is explicitly opt-in, because
    // the transmitter must be known to lie within the local ambiguity interval.
    if (!xy && (prior || (receiver && this.options.localCpr))) {
      const localRef = prior ?? receiver!;
      xy = this.resolve(2, localRef, c, c, c.odd);
      method = prior ? "local-aircraft" : "local-receiver";
      if (
        xy &&
        distanceBearing(localRef, { lat: xy[0], lon: xy[1] }).distance >
          (c.surface ? 25 : Math.min(180, this.options.rangeNm))
      )
        xy = null;
    }
    if (!xy) return;
    const p: Position = {
      lat: xy[0],
      lon: xy[1],
      at,
      method,
      surface: c.surface,
    };
    let invalid =
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lon) > 180;
    if (
      receiver &&
      distanceBearing(receiver, p).distance > this.options.rangeNm
    )
      invalid = true;
    if (c.surface && ref && distanceBearing(ref, p).distance > 45)
      invalid = true;
    if (previous && at - previous.at < 60) {
      const elapsed = Math.max(0, at - previous.at),
        distance = distanceBearing(previous, p).distance;
      if (
        distance >
        (c.surface ? 0.15 : 0.5) + ((c.surface ? 150 : 1200) * elapsed) / 3600
      )
        invalid = true;
    }
    if (invalid) {
      a.positionRejected++;
      this.rejected++;
      return;
    }
    a.position = p;
    if (!a.trail.length || at - a.trail[a.trail.length - 1].at >= 5)
      a.trail.push(p);
    a.trail = a.trail.filter((p) => at - p.at <= 600).slice(-120);
  }
  expire(now: number) {
    for (const [id, e] of this.entries)
      if (now - e.aircraft.lastSeen > 300) this.entries.delete(id);
  }
  snapshot(now: number) {
    this.expire(now);
    return [...this.entries.values()]
      .map((e) => e.aircraft)
      .filter((a) => now - a.lastSeen <= 60);
  }
}
