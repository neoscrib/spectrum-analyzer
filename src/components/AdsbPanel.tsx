import { useEffect, useMemo, useState, useRef, type RefObject } from "react";
import { AdsbMap } from "./AdsbMap";
import {
  distanceBearing,
  field,
  type AdsbBatch,
  type Aircraft,
} from "../adsb/model";
import type { Settings } from "../model";
import { download } from "../meteor/iq";
import { inspectCu8Replay, type IqReplayRequest } from "../recording/replay";
interface Props {
  queue: RefObject<AdsbBatch[]>;
  session: number;
  settings: Settings;
  busy: boolean;
  active: boolean;
  backlog: number;
  onSettings: (s: Settings) => void;
  onReplay: (r: IqReplayRequest) => void;
  replay: string | null;
}
const methods = {
  global: "Global even/odd CPR",
  "local-aircraft": "Local CPR · recent aircraft position",
  "local-receiver": "Local CPR · receiver reference",
  "surface-pair": "Surface CPR pair · nearby reference",
};
const emergency = [
  "None",
  "General emergency",
  "Lifeguard / medical",
  "Minimum fuel",
  "No communications",
  "Unlawful interference",
  "Downed aircraft",
  "Reserved",
];
const number = (n: number | undefined, digits = 0) =>
  n === undefined
    ? "—"
    : n.toLocaleString(undefined, { maximumFractionDigits: digits });
export function AdsbPanel(p: Props) {
  const [batch, setBatch] = useState<AdsbBatch | null>(null),
    [now, setNow] = useState(0),
    [selected, setSelected] = useState<string | null>(null);
  const [tiles, setTiles] = useState(true),
    [rings, setRings] = useState(true),
    [follow, setFollow] = useState(false),
    [fit, setFit] = useState(0),
    [trailSeconds, setTrailSeconds] = useState(120);
  const [sort, setSort] = useState("last"),
    [descending, setDescending] = useState(true),
    [lat, setLat] = useState(p.settings.adsb.receiver?.lat.toString() ?? ""),
    [lon, setLon] = useState(p.settings.adsb.receiver?.lon.toString() ?? "");
  const [iqFile, setIqFile] = useState<File>(),
    [metaFile, setMetaFile] = useState<File>(),
    [error, setError] = useState("");
  const latest = useRef<AdsbBatch | null>(null),
    received = useRef(0),
    active = useRef(p.active);
  active.current = p.active;
  useEffect(() => {
    latest.current = null;
    setBatch(null);
    setNow(0);
    setSelected(null);
  }, [p.session]);
  useEffect(() => {
    const id = setInterval(() => {
      const data = p.queue.current.splice(0);
      if (data.length) {
        latest.current = data.at(-1)!;
        received.current = performance.now();
        setBatch(latest.current);
      }
      const b = latest.current;
      if (b)
        setNow(
          b.seconds +
            (active.current || b.source !== "replay"
              ? (performance.now() - received.current) / 1000
              : 0),
        );
    }, 500);
    return () => clearInterval(id);
  }, [p.queue]);
  const aircraft = useMemo(
    () => batch?.aircraft.filter((a) => now - a.lastSeen <= 60) ?? [],
    [batch, now],
  );
  const rows = useMemo(() => {
    const value = (a: Aircraft): number | string => {
      const distance =
        p.settings.adsb.receiver && a.position && now - a.position.at <= 15
          ? distanceBearing(p.settings.adsb.receiver, a.position)
          : null;
      switch (sort) {
        case "icao":
          return a.address;
        case "callsign":
          return field(a, "callsign", now) ?? "";
        case "altitude":
          return (
            field(a, "baroAltitude", now) ??
            field(a, "gnssAltitude", now) ??
            -Infinity
          );
        case "speed":
          return field(a, "groundSpeed", now) ?? -Infinity;
        case "track":
          return field(a, "headingType", now) === 1
            ? (field(a, "heading", now) ?? -Infinity)
            : -Infinity;
        case "distance":
          return distance?.distance ?? Infinity;
        case "bearing":
          return distance?.bearing ?? Infinity;
        case "messages":
          return a.messages;
        default:
          return a.lastSeen;
      }
    };
    return [...aircraft].sort((a, b) => {
      const x = value(a),
        y = value(b);
      return (
        (typeof x === "string" && typeof y === "string"
          ? x.localeCompare(y)
          : Number(x) - Number(y)) * (descending ? -1 : 1)
      );
    });
  }, [aircraft, now, sort, descending, p.settings.adsb.receiver]);
  const chosen = batch?.aircraft.find((a) => a.id === selected),
    stats = batch?.stats;
  function select(id: string) {
    setSelected(id);
  }
  async function replay() {
    if (!iqFile) return;
    try {
      setError("");
      p.onReplay(await inspectCu8Replay(iqFile, metaFile, p.settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const sortButton = (id: string, label: string) => (
    <button
      onClick={() => {
        if (sort === id) setDescending(!descending);
        else {
          setSort(id);
          setDescending(false);
        }
      }}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sort === id ? (descending ? " ↓" : " ↑") : ""}
    </button>
  );
  return (
    <section className="adsb-panel" aria-label="ADS-B aircraft tracking">
      <div className="section-heading">
        <div>
          <h2>Aircraft · 1090 MHz</h2>
          <p className="caption">
            Locally received Mode S / 1090ES ·{" "}
            {batch?.source === "test"
              ? "Generated IQ · synthetic aircraft"
              : batch?.source === "replay"
                ? "Recorded IQ replay"
                : "Live receiver"}{" "}
            · {p.active ? "Receiving" : "Receiver stopped"}
          </p>
        </div>
        <span className="chip">
          {aircraft.length} aircraft ·{" "}
          {
            aircraft.filter((a) => a.position && now - a.position.at <= 15)
              .length
          }{" "}
          positions
        </span>
      </div>
      <div className="adsb-map-controls">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={tiles}
            onChange={(e) => setTiles(e.target.checked)}
          />{" "}
          OpenStreetMap tiles
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={rings}
            onChange={(e) => setRings(e.target.checked)}
          />{" "}
          Range rings
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />{" "}
          Follow selected aircraft
        </label>
        <label>
          Trails{" "}
          <select
            aria-label="Aircraft trail duration"
            value={trailSeconds}
            onChange={(e) => setTrailSeconds(Number(e.target.value))}
          >
            <option value={0}>Off</option>
            <option value={60}>1 minute</option>
            <option value={120}>2 minutes</option>
            <option value={600}>10 minutes</option>
          </select>
        </label>
        <button className="button secondary" onClick={() => setFit(fit + 1)}>
          Fit aircraft
        </button>
      </div>
      <p className="caption">
        OpenStreetMap background tiles require internet. Aircraft decoding,
        positions and trails work offline. No tile downloads for offline use.{" "}
        <a
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noreferrer"
        >
          Report a map issue
        </a>
      </p>
      <AdsbMap
        aircraft={aircraft}
        now={now}
        receiver={p.settings.adsb.receiver}
        selected={selected}
        onSelect={select}
        tiles={tiles}
        rings={rings}
        follow={follow}
        trailSeconds={trailSeconds}
        fit={fit}
      />
      <p className="caption">
        Altitude colors:{" "}
        <span style={{ color: "#59d3a8" }}>below 10,000 ft</span> ·{" "}
        <span style={{ color: "#65adf5" }}>10,000–25,000 ft</span> ·{" "}
        <span style={{ color: "#be96ff" }}>above 25,000 ft</span>. Dots indicate
        unavailable ground track. Positions older than 15 s are hidden; aircraft
        expire from the active list after 60 s.
      </p>
      <div className="adsb-table-scroll">
        <table className="adsb-table">
          <thead>
            <tr>
              {[
                ["icao", "ICAO / address"],
                ["callsign", "Callsign"],
                ["altitude", "Altitude ft"],
                ["speed", "Speed kt"],
                ["track", "Track °"],
                ["distance", "Distance NM"],
                ["bearing", "Bearing °"],
                ["last", "Last seen"],
                ["messages", "Messages"],
              ].map(([id, name]) => (
                <th
                  key={id}
                  aria-sort={
                    sort === id
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  {sortButton(id, name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const pos =
                  a.position && now - a.position.at <= 15 ? a.position : null,
                range =
                  pos && p.settings.adsb.receiver
                    ? distanceBearing(p.settings.adsb.receiver, pos)
                    : null;
              return (
                <tr
                  key={a.id}
                  data-testid="adsb-aircraft"
                  className={a.id === selected ? "selected" : ""}
                  onClick={() => select(a.id)}
                >
                  <td>
                    <button
                      className="adsb-select"
                      onClick={() => select(a.id)}
                    >
                      {a.address}
                      {!a.icao ? " · non-ICAO" : ""}
                    </button>
                    <small>
                      {pos ? methods[pos.method] : "Position unavailable"}
                    </small>
                  </td>
                  <td>{field(a, "callsign", now)?.trim() || "—"}</td>
                  <td>
                    {number(
                      field(a, "baroAltitude", now) ??
                        field(a, "gnssAltitude", now),
                    )}
                  </td>
                  <td>{number(field(a, "groundSpeed", now), 1)}</td>
                  <td>
                    {number(
                      field(a, "headingType", now) === 1
                        ? field(a, "heading", now)
                        : undefined,
                      1,
                    )}
                  </td>
                  <td>{number(range?.distance, 1)}</td>
                  <td>{number(range?.bearing)}</td>
                  <td>{number(Math.max(0, now - a.lastSeen), 1)} s</td>
                  <td>
                    {a.messages.toLocaleString()}
                    {a.corrected > 0 && <small>{a.corrected} corrected</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!aircraft.length && (
        <p className="caption">
          No aircraft received yet. Tune to 1090 MHz with a suitable antenna, or
          use the labeled test signal / recorded IQ replay. Identity-only
          messages remain visible without a position.
        </p>
      )}
      {chosen && (
        <section
          className="adsb-details"
          aria-label="Selected aircraft details"
        >
          <h3>
            {chosen.address} ·{" "}
            {field(chosen, "callsign", now)?.trim() || "Callsign unavailable"}
          </h3>
          <p className="caption">
            Last reception:{" "}
            {batch?.referenceTime
              ? new Date(
                  Date.parse(batch.referenceTime) + chosen.lastSeen * 1000,
                ).toISOString()
              : `${chosen.lastSeen.toFixed(6)} s into recording`}{" "}
            · host/capture reference, not a hardware timestamp.
          </p>
          <p className="caption">
            {chosen.icao ? "ICAO address" : "Non-ICAO / rebroadcast identity"} ·
            source {chosen.source} · address type {chosen.addressType} ·{" "}
            {number(chosen.signal, 1)} dBFS · {chosen.messages} messages /{" "}
            {chosen.corrected} corrected · {chosen.positionRejected} rejected
            positions
          </p>
          <p>
            {chosen.position
              ? `${chosen.position.lat.toFixed(5)}°, ${chosen.position.lon.toFixed(5)}° · ${methods[chosen.position.method]} · ${Math.max(0, now - chosen.position.at).toFixed(1)} s old${now - chosen.position.at > 15 ? " · STALE" : ""}`
              : "Position unavailable: waiting for a compatible CPR pair or an eligible local reference."}
          </p>
          <dl className="adsb-fields">
            {Object.entries(chosen.fields).map(([key, item]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {key === "emergency"
                    ? (emergency[Number(item?.value)] ?? "Unknown")
                    : String(item?.value)}{" "}
                  <small>
                    · {Math.max(0, now - item!.at).toFixed(1)} s old
                    {field(chosen, key as keyof typeof chosen.fields, now) ===
                    undefined
                      ? " · stale"
                      : ""}
                  </small>
                </dd>
              </div>
            ))}
          </dl>
          <details>
            <summary>Recent raw Mode S frames · latest 12</summary>
            {[...chosen.recent].reverse().map((m, i) => (
              <div className="adsb-raw" key={`${m.seconds}-${i}`}>
                <code>{m.hex}</code>
                <small>
                  {" "}
                  DF{m.df} · type {m.typeCode}/{m.subtype} ·{" "}
                  {m.corrected
                    ? `${m.corrected}-bit corrected`
                    : m.df === 17 || m.df === 18
                      ? "Clean CRC"
                      : m.df === 11
                        ? "Parity / interrogator"
                        : "Address parity · known ICAO"}{" "}
                  · {m.seconds.toFixed(6)} s
                </small>
                {m.corrected > 0 && <code>Received: {m.original}</code>}
                <pre>{JSON.stringify(m, null, 2)}</pre>
              </div>
            ))}
          </details>
        </section>
      )}
      <details>
        <summary>Receiver location & decoder options</summary>
        <p className="caption">
          Coordinates are optional. They enable distance/bearing, range checks
          and nearby surface CPR. Receiver-relative single-frame CPR assumes the
          aircraft is within the configured ambiguity range. Global airborne CPR
          works without coordinates.
        </p>
        <form
          className="adsb-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const receiver =
                lat.trim() === "" && lon.trim() === ""
                  ? null
                  : { lat: Number(lat), lon: Number(lon) };
              if ((lat.trim() === "") !== (lon.trim() === ""))
                throw Error("Enter both coordinates.");
              p.onSettings({
                ...p.settings,
                adsb: { ...p.settings.adsb, receiver },
              });
              setError("");
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <label>
            Receiver latitude
            <input
              aria-label="ADS-B receiver latitude"
              type="number"
              step="any"
              min={-85}
              max={85}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </label>
          <label>
            Receiver longitude
            <input
              aria-label="ADS-B receiver longitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
          </label>
          <button
            disabled={p.busy || (p.active && !!p.replay)}
            className="button secondary"
          >
            Save receiver location
          </button>
        </form>
        <div className="adsb-map-controls">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={p.settings.adsb.correction}
              disabled={p.busy || (p.active && !!p.replay)}
              onChange={(e) =>
                p.onSettings({
                  ...p.settings,
                  adsb: { ...p.settings.adsb, correction: e.target.checked },
                })
              }
            />{" "}
            Conservative one-bit correction · known addresses only
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={p.settings.adsb.localCpr}
              disabled={p.busy || (p.active && !!p.replay)}
              onChange={(e) =>
                p.onSettings({
                  ...p.settings,
                  adsb: { ...p.settings.adsb, localCpr: e.target.checked },
                })
              }
            />{" "}
            Receiver-relative local CPR
          </label>
          <label>
            Maximum receiver range{" "}
            <select
              aria-label="ADS-B maximum receiver range"
              value={p.settings.adsb.rangeNm}
              disabled={p.busy || (p.active && !!p.replay)}
              onChange={(e) =>
                p.onSettings({
                  ...p.settings,
                  adsb: { ...p.settings.adsb, rangeNm: Number(e.target.value) },
                })
              }
            >
              {[25, 50, 100, 150, 180, 250, 300].map((n) => (
                <option value={n} key={n}>
                  {n} NM
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <details>
        <summary>Recorded IQ & SigMF replay</summary>
        <p className="caption">
          CU8 at 2.4 MSPS · one fixed-frequency capture. Optional SigMF metadata
          supplies center frequency and capture UTC. Replay is paced at 1× and
          uses the same decoder.
        </p>
        <div className="adsb-form">
          <label>
            IQ file
            <input
              type="file"
              accept=".cu8,.sigmf-data"
              aria-label="ADS-B IQ file"
              onChange={(e) => setIqFile(e.target.files?.[0])}
            />
          </label>
          <label>
            SigMF metadata
            <input
              type="file"
              accept=".sigmf-meta,.json"
              aria-label="ADS-B SigMF metadata"
              onChange={(e) => setMetaFile(e.target.files?.[0])}
            />
          </label>
          <button
            className="button secondary"
            disabled={!iqFile || p.active || p.busy}
            onClick={() => void replay()}
          >
            Replay ADS-B IQ
          </button>
        </div>
        {p.replay && <p role="status">{p.replay}</p>}
      </details>
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>ADS-B diagnostics</summary>
        <dl className="adsb-fields">
          {stats &&
            Object.entries(stats).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{number(value, 2)}</dd>
              </div>
            ))}
        </dl>
        <p className="caption">
          Source clock: {number(now, 3)} s · RF queue: {p.backlog}/12. Overload
          detection stops reception rather than dropping RF samples. WebUSB does
          not expose hardware-overrun counters; discontinuities count observable
          source-clock gaps. Signal and capture power are relative dBFS, not
          calibrated RF power.
        </p>
      </details>
      <button
        className="button secondary"
        disabled={!batch?.aircraft.length}
        onClick={() =>
          download(
            new Blob([JSON.stringify(batch, null, 2)], {
              type: "application/json",
            }),
            "adsb-session.json",
          )
        }
      >
        Export aircraft snapshot
      </button>
      <p className="caption">
        1090ES only; 978 MHz UAT and multilateration are separate protocols.
        Locally decoded reports are unauthenticated and unsuitable for
        navigation or safety decisions.
      </p>
    </section>
  );
}
