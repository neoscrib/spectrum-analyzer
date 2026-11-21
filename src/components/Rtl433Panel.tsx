import { useEffect, useState } from "react";
import type {
  Rtl433Message,
  Rtl433Options,
  Rtl433Protocol,
  Rtl433Status,
} from "../rtl433/model";

export function Rtl433Panel({
  status,
  protocols,
  messages,
  options,
  active,
  test,
  busy,
  onApply,
  onClear,
}: {
  status: Rtl433Status | null;
  protocols: Rtl433Protocol[];
  messages: Rtl433Message[];
  options: Rtl433Options;
  active: boolean;
  test: boolean;
  busy: boolean;
  onApply(options: Rtl433Options): void;
  onClear(): void;
}) {
  const [draft, setDraft] = useState(options),
    [search, setSearch] = useState("");
  useEffect(() => setDraft(options), [options]);
  const filtered = messages.filter((m) =>
    JSON.stringify(m.data).toLowerCase().includes(search.toLowerCase()),
  );
  function exportMessages() {
    const url = URL.createObjectURL(
      new Blob(
        [
          messages
            .map((m) => JSON.stringify({ ...m, engine: "rtl_433 25.12" }))
            .join("\n") + "\n",
        ],
        { type: "application/x-ndjson" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "rtl433-messages.jsonl";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="rtl433-panel" aria-label="rtl_433 reception">
      <div className="nfm-heading">
        <h2>
          rtl_433 <small>25.12 · WASM</small>
        </h2>
        <span className="chip">{active ? "Listening" : "Stopped"}</span>
      </div>
      {test && (
        <p className="armer-test-note">
          GENERATED TEST · Nexus temperature/humidity OOK and a fabricated Gen3
          FSK frame. These are local fixtures, not received radio traffic.
        </p>
      )}
      <p className="caption">
        Tune the decoder to a device’s frequency, such as 433.92, 315, 868 or
        915 MHz. The selected channel is filtered from the 2.4 MSPS capture;
        this decoder produces data.
      </p>
      <div className="rtl433-controls">
        <label>
          Protocol set
          <select
            aria-label="rtl_433 protocol set"
            value={draft.mode}
            onChange={(e) =>
              setDraft({
                ...draft,
                mode: e.target.value as Rtl433Options["mode"],
              })
            }
          >
            <option value="default">Upstream defaults</option>
            <option value="all">All protocols (more false positives)</option>
            <option value="single" disabled={!protocols.length}>
              One protocol
            </option>
          </select>
        </label>
        {draft.mode === "single" && (
          <label>
            Protocol
            <select
              aria-label="rtl_433 protocol"
              value={draft.protocol}
              onChange={(e) =>
                setDraft({ ...draft, protocol: Number(e.target.value) })
              }
            >
              {protocols.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} · {p.name}
                  {p.disabled ? " (optional)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          OOK threshold
          <select
            aria-label="rtl_433 threshold"
            value={draft.level === null ? "auto" : "manual"}
            onChange={(e) =>
              setDraft({
                ...draft,
                level: e.target.value === "auto" ? null : -25,
              })
            }
          >
            <option value="auto">Automatic</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        {draft.level !== null && (
          <label>
            Threshold dBFS
            <input
              aria-label="rtl_433 threshold dBFS"
              type="number"
              min="-60"
              max="-1"
              value={draft.level}
              onChange={(e) =>
                setDraft({ ...draft, level: Number(e.target.value) })
              }
            />
          </label>
        )}
        <button
          className="button"
          disabled={busy}
          onClick={() => onApply(draft)}
        >
          Apply rtl_433 settings
        </button>
      </div>
      <div className="nfm-readings" data-testid="rtl433-stats">
        <div>
          <span>Enabled protocols</span>
          <strong>
            {status
              ? `${status.enabled} / ${protocols.length}`
              : "Start a source to load"}
          </strong>
        </div>
        <div>
          <span>Detected OOK / FSK bursts</span>
          <strong>{status ? `${status.ook} / ${status.fsk}` : "—"}</strong>
        </div>
        <div>
          <span>Decoded messages</span>
          <strong>{status?.messages ?? 0}</strong>
        </div>
        <div>
          <span>Output drops / oversize</span>
          <strong>
            {status ? `${status.dropped} / ${status.truncated}` : "0 / 0"}
          </strong>
        </div>
      </div>
      <div className="rtl433-toolbar">
        <label>
          Search messages
          <input
            type="search"
            aria-label="Search rtl_433 messages"
            value={search}
            placeholder="Model, ID or field…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={!messages.length}
          onClick={exportMessages}
        >
          Export messages JSONL
        </button>
        <button
          className="button"
          disabled={!messages.length}
          onClick={onClear}
        >
          Clear messages
        </button>
      </div>
      <p className="caption">
        {filtered.length} shown · last {messages.length} / 300 retained. Time is
        seconds into the current decoder session. Signal levels are relative to
        filtered IQ.
      </p>
      <div className="rtl433-messages" data-testid="rtl433-messages">
        {filtered.length ? (
          [...filtered].reverse().map((m) => (
            <details
              key={m.id}
              className="rtl433-message"
              open={filtered.length < 4}
            >
              <summary>
                <strong>{String(m.data.model ?? "Unknown device")}</strong>
                <span>
                  {m.data.id !== undefined
                    ? `ID ${m.data.id}`
                    : `Protocol ${m.data.protocol ?? "?"}`}
                </span>
                <span>
                  {(m.frequency / 1e6).toFixed(4)} MHz ·{" "}
                  {m.source === "test" ? "GENERATED TEST" : "LIVE"} ·{" "}
                  {String(m.data.time ?? "—")}
                </span>
              </summary>
              <pre>{JSON.stringify(m.data, null, 2)}</pre>
            </details>
          ))
        ) : (
          <p className="caption">
            No decoded messages yet. A carrier alone may not contain a supported
            protocol. Try the test signal to check the pipeline.
          </p>
        )}
      </div>
      <p className="caption">
        The full protocol registry is compiled in; default-disabled protocols
        are optional. This 240 kSPS engine supports channels up to 200 kHz, so
        some protocols require a different sample rate or RF bandwidth.
        Encrypted fields stay encrypted.{" "}
        <a href="/licenses/rtl_433-NOTICE.txt" target="_blank" rel="noreferrer">
          License &amp; source
        </a>
      </p>
    </section>
  );
}
