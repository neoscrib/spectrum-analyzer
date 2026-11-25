import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Settings } from "../model";
import type { SameBatch, SameOptions, SameRecord } from "../same/model";
import { SameHistory, matchesFilters } from "../same/history";
import { download, type IqSource } from "../meteor/iq";

export interface AnalogReplayRequest {
  file: File;
  source: IqSource;
  settings: Settings;
}
const verified = (r: SameRecord) =>
  ({
    single: "Single header · unconfirmed",
    agreed: "Repeated headers agree",
    recovered: "Recovered from repeated headers",
    unverified: "Incomplete / unverified",
  })[r.verification];
const local = (date: string) => new Date(date).toLocaleString();
const SameRow = memo(function SameRow({ record: r }: { record: SameRecord }) {
  const h = r.header;
  const sourceName =
    r.source === "generated"
      ? "Test audio"
      : r.stream.replace(/@audio$/, "").replace(/^Audio file: /, "");
  return (
    <tr
      className={`same-${h?.category ?? "unknown"} ${["single", "unverified"].includes(r.verification) ? "same-unconfirmed" : ""}`}
      data-testid="same-record"
    >
      <td>
        <strong>
          {h
            ? `${h.event} · ${h.eventName}`
            : r.kind === "eom"
              ? "NNNN · End of message"
              : r.kind === "tone"
                ? r.tone === "noaa1050"
                  ? "NOAA · 1050 Hz tone"
                  : "EAS · 853 + 960 Hz tones"
                : r.kind === "rejected"
                  ? "Decoder rejection"
                  : "Unverified header"}
        </strong>
        <br />
        <span className="caption">
          {r.frequency ? `${(r.frequency / 1e6).toFixed(4)} MHz` : sourceName} ·{" "}
          {r.source === "test" || r.source === "generated"
            ? "GENERATED"
            : r.source === "replay"
              ? "IQ replay"
              : r.source === "file"
                ? "Audio file"
                : "Live"}
        </span>
      </td>
      <td>
        <span className="chip">
          {r.kind === "tone"
            ? r.active
              ? "Last observed active"
              : "Ended"
            : r.kind === "eom"
              ? r.verification === "recovered"
                ? "Recovered EOM marker"
                : r.observations >= 2
                  ? "Repeated EOM markers"
                  : "EOM marker observed"
              : verified(r)}
        </span>
        <br />
        <span className="caption">
          {r.kind === "tone"
            ? `${r.active ? "At least " : ""}${r.duration?.toFixed(2)} s observed`
            : `${r.observations} burst${r.observations === 1 ? "" : "s"}`}
          {r.retransmissions ? ` · ${r.retransmissions} retransmissions` : ""}
          {r.ended ? " · EOM received" : ""}
        </span>
      </td>
      <td>
        <details>
          <summary>Details · {local(r.received)}</summary>
          {h && (
            <dl className="same-fields">
              <div>
                <dt>Originator</dt>
                <dd>
                  {h.originator} · {h.originatorName}
                </dd>
              </div>
              <div>
                <dt>Affected areas</dt>
                <dd>
                  {h.locations.map((a, n) => (
                    <span className="same-area" key={`${a.code}-${n}`}>
                      {a.code} · {a.name}
                      {!a.known ? " · Unrecognized code" : ""}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt>Issued · UTC</dt>
                <dd>{h.issued.replace("T", " ").replace(".000Z", " UTC")}</dd>
              </div>
              <div>
                <dt>Issued · local</dt>
                <dd>{local(h.issued)}</dd>
              </div>
              <div>
                <dt>Message purge · UTC</dt>
                <dd>
                  {h.expires.replace("T", " ").replace(".000Z", " UTC")} ·{" "}
                  {h.durationMinutes} min from issue
                </dd>
              </div>
              <div>
                <dt>Message purge · local</dt>
                <dd>{local(h.expires)}</dd>
              </div>
              <div>
                <dt>Year</dt>
                <dd>
                  {h.inferredYear} · inferred from capture reference; absent
                  from SAME
                </dd>
              </div>
              <div>
                <dt>Sender</dt>
                <dd>
                  <code>{h.sender}</code>
                </dd>
              </div>
              <div>
                <dt>Decoded header</dt>
                <dd>
                  <code>{h.raw}</code>
                </dd>
              </div>
            </dl>
          )}
          <p className="caption">
            Received {r.received} · source offset {r.seconds.toFixed(3)} s ·
            last reception {r.lastReceived}
          </p>
          {r.ended && (
            <p className="caption">
              Message terminated at {r.ended}. EOM identifies the latest message
              on this stream; it carries no alert ID.
            </p>
          )}
          {r.tone && (
            <p className="caption">
              Observed duration {r.active ? "at least " : ""}
              {r.duration?.toFixed(2)} s · window resolution ±40 ms. Tone
              observations are independent of header verification.
            </p>
          )}
          {r.reason && <p className="caption">{r.reason}</p>}
          {r.voted !== undefined && (
            <p className="caption">
              Combiner: {r.voted} bytes used three-way voting; {r.errors} bit
              disagreements. Agreement is not authentication.
            </p>
          )}
          {r.raw.length > 0 && (
            <>
              <span className="field-label">
                Raw received bursts · escaped control bytes
              </span>
              <pre>{r.raw.map((s) => JSON.stringify(s)).join("\n")}</pre>
            </>
          )}
        </details>
      </td>
    </tr>
  );
});

export function SamePanel({
  settings,
  queue,
  sessionKey,
  active,
  busy,
  onOptions,
  onReplay,
}: {
  settings: Settings;
  queue: RefObject<SameBatch[]>;
  sessionKey: number;
  active: boolean;
  busy: boolean;
  onOptions: (options: SameOptions) => void;
  onReplay: (request: AnalogReplayRequest) => void;
}) {
  const supported = ["am", "nfm", "wfm"].includes(settings.decoder);
  const history = useRef(new SameHistory());
  const [records, setRecords] = useState<SameRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, SameBatch>>({});
  const [expanded, setExpanded] = useState(settings.same.enabled);
  const [areas, setAreas] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileState, setFileState] = useState("");
  const [error, setError] = useState("");
  const [reference, setReference] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [iqFile, setIqFile] = useState<File | null>(null);
  const [metaFile, setMetaFile] = useState<File | null>(null);
  const fileWorker = useRef<Worker | null>(null);
  const imported = useRef<SameBatch[]>([]);
  useEffect(() => {
    history.current = new SameHistory();
    queue.current = [];
    imported.current = [];
    setRecords([]);
    setDiagnostics({});
  }, [sessionKey, queue]);
  useEffect(() => {
    if (settings.same.enabled) setExpanded(true);
  }, [settings.same.enabled]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!queue.current.length && !imported.current.length) return;
      const batches = [
        ...queue.current.splice(0),
        ...imported.current.splice(0),
      ];
      if (!batches.length) return;
      let changed = false;
      const status: Record<string, SameBatch> = {};
      for (const batch of batches) {
        const received = new Date();
        const anchor = batch.referenceTime
          ? new Date(batch.referenceTime)
          : received;
        history.current.ingest(batch, received, anchor);
        changed ||= batch.events.length > 0;
        if (batch.diagnostics) status[batch.stream] = batch;
      }
      if (changed) setRecords(history.current.records.map((r) => ({ ...r })));
      if (Object.keys(status).length)
        setDiagnostics((old) =>
          Object.fromEntries(Object.entries({ ...old, ...status }).slice(-32)),
        );
    }, 250);
    return () => {
      clearInterval(timer);
      fileWorker.current?.terminate();
    };
  }, [queue]);
  const areaCodes = useMemo(
    () => areas.split(/[\s,]+/).filter(Boolean),
    [areas],
  );
  const eventCodes = useMemo(
    () =>
      eventFilter
        .toUpperCase()
        .split(/[\s,]+/)
        .filter(Boolean),
    [eventFilter],
  );
  const filterError = areaCodes.some((v) => !/^\d{6}$/.test(v))
    ? "Use six-digit SAME area codes, separated by commas."
    : eventCodes.some((v) => !/^[A-Z]{3}$/.test(v))
      ? "Use three-letter event codes, separated by commas."
      : "";
  const filtered = useMemo(
    () =>
      filterError
        ? []
        : records.filter((r) => matchesFilters(r, areaCodes, eventCodes)),
    [records, areaCodes, eventCodes, filterError],
  );
  function analyze(file?: File) {
    if (fileBusy) return;
    const date = new Date(reference + "Z");
    if (!Number.isFinite(date.getTime())) {
      setError("Choose a valid UTC capture reference date.");
      return;
    }
    setError("");
    setFileBusy(true);
    setExpanded(true);
    setFileState(
      file ? `Analyzing ${file.name}…` : "Analyzing GENERATED test audio…",
    );
    const worker = new Worker(
      new URL("../same/file.worker.ts", import.meta.url),
      { type: "module" },
    );
    fileWorker.current = worker;
    worker.onmessage = ({
      data,
    }: MessageEvent<
      | { type: "batch"; batch: SameBatch }
      | { type: "error"; message: string }
      | { type: "complete"; samples: number; rate: number }
      | { type: "progress"; fraction: number }
    >) => {
      if (data.type === "batch") imported.current.push(data.batch);
      if (data.type === "error") {
        setError(data.message);
        setFileBusy(false);
        worker.terminate();
        fileWorker.current = null;
      }
      if (data.type === "complete") {
        setFileState(
          `Decoded ${(data.samples / data.rate).toFixed(1)} s of ${file ? "recorded" : "GENERATED test"} audio · ${(data.rate / 1000).toFixed(2)} kHz`,
        );
        setFileBusy(false);
        worker.terminate();
        fileWorker.current = null;
      }
    };
    worker.onerror = (e) => {
      setError(e.message);
      setFileBusy(false);
      worker.terminate();
      fileWorker.current = null;
    };
    worker.postMessage({
      file,
      generated: !file,
      attention: settings.same.attention,
      reference: date.toISOString(),
    });
  }
  async function replayIq() {
    if (!iqFile) return;
    try {
      let center = settings.center,
        referenceTime = new Date(reference + "Z").toISOString();
      if (metaFile) {
        if (metaFile.size > 1024 * 1024)
          throw Error("SigMF metadata is too large.");
        const meta: unknown = JSON.parse(await metaFile.text());
        if (!meta || typeof meta !== "object")
          throw Error("Invalid SigMF metadata.");
        const global =
          "global" in meta && typeof meta.global === "object" && meta.global
            ? (meta.global as Record<string, unknown>)
            : {};
        if (
          global["core:datatype"] !== "cu8" ||
          global["core:sample_rate"] !== 2400000
        )
          throw Error("Analog replay requires CU8 at 2.4 MSPS.");
        const captures =
          "captures" in meta && Array.isArray(meta.captures)
            ? (meta.captures as unknown[])
            : [];
        if (captures.length > 1)
          throw Error(
            "Analog replay currently supports a single fixed-frequency SigMF capture.",
          );
        const capture = captures[0];
        if (capture && typeof capture === "object") {
          if (
            "core:sample_start" in capture &&
            capture["core:sample_start"] !== 0
          )
            throw Error(
              "Analog replay expects the SigMF capture to start at sample zero.",
            );
          if (
            "core:frequency" in capture &&
            typeof capture["core:frequency"] === "number"
          )
            center = capture["core:frequency"];
          if (
            "core:datetime" in capture &&
            typeof capture["core:datetime"] === "string"
          )
            referenceTime = new Date(capture["core:datetime"]).toISOString();
        }
      }
      if (!iqFile.size || iqFile.size % 2)
        throw Error("CU8 recordings must contain complete I/Q pairs.");
      onReplay({
        file: iqFile,
        source: {
          format: "cu8",
          sampleRate: 2400000,
          offset: 0,
          length: iqFile.size,
          center,
          referenceTime,
        },
        settings: {
          ...settings,
          center,
          same: { ...settings.same, enabled: true },
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  if (!supported && !records.length) return null;
  return (
    <section className="rds-panel same-panel" aria-label="EAS/SAME reception">
      <div className="rds-heading">
        <h2>EAS / SAME</h2>
        <span className="chip">
          {supported && settings.same.enabled
            ? active
              ? Object.keys(diagnostics).length
                ? "Listening to demodulated audio"
                : "Enabling · awaiting audio"
              : "Enabled · receiver stopped"
            : "Disabled"}
        </span>
      </div>
      <div className="same-controls">
        <label className="checkbox-label">
          <input
            type="checkbox"
            aria-label="Decode EAS/SAME"
            checked={settings.same.enabled}
            disabled={!supported || busy}
            onChange={(e) =>
              onOptions({ ...settings.same, enabled: e.target.checked })
            }
          />{" "}
          Decode EAS/SAME
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            aria-label="Detect attention tones"
            checked={settings.same.attention}
            disabled={busy}
            onChange={(e) =>
              onOptions({ ...settings.same, attention: e.target.checked })
            }
          />{" "}
          Detect attention tones
        </label>
      </div>
      <p className="caption">
        One audio decoder for AM, NFM and WFM · before squelch, code filtering
        and speaker volume. Experimental receiver; use a dedicated emergency
        alert radio for warnings.
      </p>
      <details
        open={expanded}
        onToggle={(e) => setExpanded(e.currentTarget.open)}
      >
        <summary>Alert history · {records.length} records</summary>
        <p className="caption">
          Message purge is not the end of the hazard. SAME has no checksum or
          authentication. A single header is unconfirmed; repeated agreement and
          recovered messages are labeled separately. No automatic notifications
          or playback changes.
        </p>
        <div className="same-filters">
          <label>
            Geographic areas
            <input
              aria-label="SAME geographic filter"
              value={areas}
              placeholder="027065, 027095"
              onChange={(e) => setAreas(e.target.value)}
            />
          </label>
          <label>
            Event codes
            <input
              aria-label="SAME event filter"
              value={eventFilter}
              placeholder="TOR, SVR, RWT"
              onChange={(e) => setEventFilter(e.target.value)}
            />
          </label>
        </div>
        {filterError && <p role="status">{filterError}</p>}
        <p className="caption">
          {filtered.length} matching · latest 50 shown / 200 retained. Filters
          affect display only; state-wide and nationwide alerts match their
          covered counties.
        </p>
        <div className="same-table-wrap">
          <table className="same-table">
            <thead>
              <tr>
                <th>Event / signal</th>
                <th>Reception</th>
                <th>Metadata / raw data</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((r) => (
                <SameRow key={r.id} record={r} />
              ))}
            </tbody>
          </table>
        </div>
        {!records.length && (
          <p className="caption">
            No SAME headers or attention tones received in this session.
          </p>
        )}
        <button
          className="button secondary"
          disabled={!records.length}
          onClick={() =>
            download(
              new Blob([JSON.stringify(records, null, 2)], {
                type: "application/json",
              }),
              "same-session.json",
            )
          }
        >
          Export SAME history
        </button>
      </details>
      <details className="same-diagnostics">
        <summary>Decoder diagnostics</summary>
        <p className="caption">
          Retained headers: {records.filter((r) => r.header).length} parsed /{" "}
          {records.filter((r) => r.verification === "recovered").length}{" "}
          recovered / {records.filter((r) => r.kind === "candidate").length}{" "}
          incomplete. AFSK state is a 40 ms observation; synchronization comes
          from the modem.
        </p>
        {Object.entries(diagnostics).map(([key, b]) => (
          <div key={key}>
            <p className="caption">
              {key} · {b.sampleRate} Hz audio · {b.processingMs.toFixed(2)} ms
              processing per reported interval
            </p>
            <dl className="same-fields">
              <div>
                <dt>AFSK / synchronization</dt>
                <dd>
                  {b.diagnostics?.afsk} · {b.diagnostics?.link}
                </dd>
              </div>
              <div>
                <dt>Bursts / assembled / rejected</dt>
                <dd>
                  {b.diagnostics?.bursts} / {b.diagnostics?.messages} /{" "}
                  {b.diagnostics?.rejected}
                </dd>
              </div>
              <div>
                <dt>Sync losses / output drops / missing EOM timeouts</dt>
                <dd>
                  {b.diagnostics?.syncLosses} / {b.diagnostics?.dropped} /{" "}
                  {b.diagnostics?.timedOut ?? 0}
                </dd>
              </div>
              <div>
                <dt>Last assembled decode</dt>
                <dd>
                  {b.diagnostics?.lastSuccess === null
                    ? "None"
                    : `${((b.diagnostics?.lastSuccess ?? 0) + b.sourceSeconds).toFixed(3)} s into source`}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </details>
      <details>
        <summary>Recorded audio, IQ replay &amp; generated test</summary>
        <p className="caption">
          NOAA example near Mora, Minnesota: 162.425 MHz · NFM · 25 kHz width ·
          ±5 kHz deviation. Kanabec County: 027065. SAME is sent only during
          alerts and tests, not continuously.
        </p>
        <label className="same-reference">
          Capture reference · UTC (year inference)
          <input
            type="datetime-local"
            aria-label="SAME capture reference UTC"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <div className="same-controls">
          <label className="button secondary">
            Decode WAV audio
            <input
              className="same-file"
              type="file"
              aria-label="SAME audio WAV"
              accept=".wav,audio/wav"
              disabled={fileBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) analyze(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="button secondary"
            disabled={fileBusy}
            onClick={() => analyze()}
          >
            Decode generated SAME test audio
          </button>
          {fileBusy && (
            <button
              className="button secondary"
              onClick={() => {
                fileWorker.current?.terminate();
                fileWorker.current = null;
                setFileBusy(false);
                setFileState("Audio analysis stopped.");
              }}
            >
              Stop audio analysis
            </button>
          )}
        </div>
        <p className="caption">
          WAV analysis reads bounded chunks at the original 8–96 kHz rate and
          leaves radio playback running. Generated audio is a labeled
          weekly-test fixture, not a received broadcast.
        </p>
        <div className="same-filters">
          <label>
            Raw IQ · CU8, 2.4 MSPS
            <input
              type="file"
              aria-label="SAME IQ recording"
              accept=".cu8,.sigmf-data"
              disabled={active || busy}
              onChange={(e) => setIqFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Optional SigMF metadata
            <input
              type="file"
              aria-label="SAME IQ metadata"
              accept=".sigmf-meta,.json"
              disabled={active || busy}
              onChange={(e) => setMetaFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <button
          className="button secondary"
          disabled={!supported || !iqFile || active || busy}
          onClick={() => void replayIq()}
        >
          Replay IQ through {settings.decoder.toUpperCase()} + SAME
        </button>
        <p className="caption">
          Set the decoder frequency to the recorded station before replay. SigMF
          sets the capture center and reference date; raw IQ without metadata
          uses the current center/reference. Replay runs at 1× with normal audio
          controls.
        </p>
        {fileState && <p role="status">{fileState}</p>}
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
