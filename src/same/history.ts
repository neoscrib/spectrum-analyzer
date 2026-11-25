import { parseSame, matchesLocation, headerPrefix } from "./parse";
import type { SameBatch, SameRecord, SameHeader } from "./model";

/** Bounded session history; display filters never modify the received records.
 * Single bursts are parsed candidates, not confirmed warnings. SAME has no CRC
 * or authentication. Transport agreement/recovery is evidence of repetition. */
export class SameHistory {
  records: SameRecord[] = [];
  private nextId = 0;
  private lastHeader = new Map<string, number>();
  ingest(batch: SameBatch, received = new Date(), reference = received) {
    for (const event of [...batch.events].sort(
      (a, b) => a.seconds - b.seconds,
    )) {
      const common = {
        stream: batch.stream,
        frequency: batch.frequency,
        source: batch.source,
        received: received.toISOString(),
        lastReceived: received.toISOString(),
        seconds: batch.sourceSeconds + event.seconds,
        lastSeconds: batch.sourceSeconds + event.seconds,
      };
      const existing = this.records.find(
        (r) => r.id === this.lastHeader.get(batch.stream),
      );
      if (event.kind === "tone") {
        let record = this.records.find(
          (r) =>
            r.stream === batch.stream &&
            r.kind === "tone" &&
            r.tone === event.tone &&
            Math.abs(r.seconds - batch.sourceSeconds - event.start) < 0.05,
        );
        if (!record) {
          record = {
            id: ++this.nextId,
            ...common,
            seconds: batch.sourceSeconds + event.start,
            kind: "tone",
            verification: "unverified",
            raw: [],
            observations: 1,
            retransmissions: 0,
            tone: event.tone,
          };
          this.records.unshift(record);
        }
        record.active = event.edge === "start";
        record.duration = (event.end ?? event.seconds) - event.start;
        record.lastReceived = common.lastReceived;
        continue;
      }
      if (event.kind === "rejected") {
        this.records.unshift({
          id: ++this.nextId,
          ...common,
          kind: "rejected",
          verification: "unverified",
          raw: [],
          observations: 1,
          retransmissions: 0,
          reason: event.reason,
        });
        continue;
      }
      const raw = event.raw;
      if (raw.startsWith("NNNN")) {
        let end = this.records.find(
          (r) =>
            r.kind === "eom" &&
            r.stream === batch.stream &&
            common.seconds - r.seconds < 20 &&
            common.seconds >= r.seconds,
        );
        if (!end) {
          end = {
            id: ++this.nextId,
            ...common,
            kind: "eom",
            verification: event.kind === "message" ? "recovered" : "single",
            raw: [],
            observations: 0,
            retransmissions: 0,
          };
          this.records.unshift(end);
        }
        if (event.kind === "burst") {
          end.observations++;
          end.raw = [...end.raw, raw].slice(-12);
        }
        const exactMarkers = end.raw.filter((s) => s.startsWith("NNNN")).length;
        end.verification =
          exactMarkers >= 2
            ? "agreed"
            : exactMarkers === 1
              ? "single"
              : "recovered";
        end.lastReceived = common.lastReceived;
        if (existing) existing.ended = common.lastReceived;
        continue;
      }
      let header: SameHeader | undefined, reason: string | undefined;
      const canonical = headerPrefix(raw) ?? raw;
      try {
        header = parseSame(canonical, reference);
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
      let record = this.records.find(
        (r) =>
          r.stream === batch.stream &&
          (r.raw.includes(raw) || r.header?.raw === canonical) &&
          r.kind !== "eom",
      );
      if (!record) {
        // A recovered transport message folds the three recent burst records
        // into one logical record, retaining every raw estimate as evidence.
        const candidates =
          event.kind === "message" && header
            ? this.records
                .filter(
                  (r) =>
                    r.stream === batch.stream &&
                    (r.kind === "candidate" || r.kind === "alert") &&
                    common.seconds - r.seconds >= 0 &&
                    common.seconds - r.seconds <= 25,
                )
                .slice(0, 3)
            : [];
        record = {
          id: ++this.nextId,
          ...common,
          kind: header ? "alert" : "candidate",
          verification: header ? "single" : "unverified",
          raw: [],
          observations: 0,
          retransmissions: 0,
          header,
          reason,
        };
        if (
          candidates.length &&
          !candidates.some(
            (r) =>
              r.header && r.header.raw !== raw && r.verification !== "single",
          )
        ) {
          record.raw = candidates
            .reverse()
            .flatMap((r) => r.raw)
            .slice(-12);
          record.observations = candidates.reduce(
            (n, r) => n + r.observations,
            0,
          );
          this.records = this.records.filter((r) => !candidates.includes(r));
        }
        this.records.unshift(record);
      }
      const sourceGap = common.seconds - record.lastSeconds;
      // RF configuration resets its sample clock; archived audio instead uses
      // its own timeline even when analyzed much faster than real time.
      const wallGap =
        batch.source === "live" || batch.source === "test"
          ? (Date.parse(common.lastReceived) -
              Date.parse(record.lastReceived)) /
            1000
          : 0;
      const gap = Math.max(sourceGap, wallGap);
      if (event.kind === "burst") {
        record.observations++;
        record.raw = [...record.raw, raw].slice(-12);
        if (gap > 30) record.retransmissions++;
      }
      if (event.kind === "message" && header) {
        const exact = record.raw.filter(
          (r) => headerPrefix(r) === canonical,
        ).length;
        record.verification = exact >= 2 ? "agreed" : "recovered";
        record.voted = event.voted;
        record.errors = event.errors;
      }
      record.lastReceived = common.lastReceived;
      record.lastSeconds = common.seconds;
      if (header) {
        record.header = header;
        record.kind = "alert";
        this.lastHeader.set(batch.stream, record.id);
      }
    }
    this.records = this.records.slice(0, 200);
    const ids = new Set(this.records.map((r) => r.id));
    for (const [stream, id] of this.lastHeader)
      if (!ids.has(id)) this.lastHeader.delete(stream);
  }
}
export function matchesFilters(
  record: SameRecord,
  locations: string[],
  events: string[],
) {
  if (!record.header) return true;
  return (
    (!events.length || events.includes(record.header.event)) &&
    (!locations.length ||
      record.header.locations.some((a) =>
        locations.some((b) => matchesLocation(a.code, b)),
      ))
  );
}
