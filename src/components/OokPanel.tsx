import { useEffect, useState } from "react";
import {
  ookText,
  validateOok,
  type OokOptions,
  type OokCapture,
  type OokStatus,
} from "../ook/model";
import { OokBurstViewer } from "./OokBurstViewer";
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OokPanel({
  status,
  captures,
  options,
  active,
  test,
  busy,
  onApply,
  onClear,
}: {
  status: OokStatus | null;
  captures: OokCapture[];
  options: OokOptions;
  active: boolean;
  test: boolean;
  busy: boolean;
  onApply: (o: OokOptions) => Promise<boolean>;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(options),
    [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => {
    setDraft(options);
    setError("");
  }, [options]);
  const selected = captures.find((c) => c.id === selectedId) ?? captures.at(-1);
  const [showBytes, setShowBytes] = useState(true);
  const set = <K extends keyof OokOptions>(key: K, value: OokOptions[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <section className="ook-panel" aria-label="OOK / ASK reception">
      <div className="nfm-heading">
        <h2>OOK / ASK pulse analyzer</h2>
        <span className={`chip ${active && status?.high ? "armer-lock" : ""}`}>
          {!active
            ? "Stopped"
            : status?.high
              ? "High level"
              : "Listening for bursts"}
        </span>
      </div>
      {test && (
        <p className="armer-test-note">
          GENERATED OOK / ASK IQ · 433.920 MHz · alternating on/off and
          nonzero-low ASK. Test payload A6: PWM 500 / 1000 µs high, 500 µs low,
          once per second. Not received radio traffic.
        </p>
      )}
      <p className="caption">
        Binary amplitude keying: capture high/low timings, then choose a bit
        interpretation. Device identity, payload fields, and checksums require a
        device-specific protocol.
      </p>
      <div className="nfm-readings ook-readings">
        <div>
          <span>Channel level</span>
          <strong>{status ? `${status.level.toFixed(1)} dBFS` : "—"}</strong>
        </div>
        <div>
          <span>Slicing threshold</span>
          <strong data-testid="ook-threshold">
            {status ? `${status.threshold.toFixed(1)} dBFS` : "—"}
          </strong>
        </div>
        <div>
          <span>Bursts / discarded</span>
          <strong data-testid="ook-count">
            {status ? `${status.bursts} / ${status.rejected}` : "0 / 0"}
          </strong>
        </div>
        <div>
          <span>Timing resolution</span>
          <strong>8.33 µs · 120 kSPS</strong>
        </div>
      </div>
      {status && (
        <div className="ook-envelope">
          <svg
            role="img"
            aria-label="OOK envelope and threshold"
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
          >
            <line
              x1="12"
              x2="988"
              y1={10 + (Math.min(90, -status.threshold) / 90) * 80}
              y2={10 + (Math.min(90, -status.threshold) / 90) * 80}
              className="ook-threshold-line"
            />
            <polyline
              points={status.trace
                .map(
                  (v, i) =>
                    `${12 + (i / 511) * 976},${10 + (Math.min(90, Math.max(0, -v)) / 90) * 80}`,
                )
                .join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="ook-axis">
            <span>
              −{((status.trace.length / status.traceRate) * 1000).toFixed(1)} ms
            </span>
            <span>0 ms · 0 to −90 dBFS</span>
          </div>
          <p className="caption">
            Live envelope snapshot · dashed line: slicing threshold · short
            bursts may fall between updates.
          </p>
        </div>
      )}
      <form
        className="ook-config"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            validateOok(draft);
            setError("");
            void onApply(draft);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="ook-options">
            <label>
              Threshold mode
              <select
                aria-label="OOK threshold mode"
                value={draft.threshold === null ? "auto" : "manual"}
                onChange={(e) =>
                  set("threshold", e.target.value === "auto" ? null : -25)
                }
              >
                <option value="auto">Automatic · adaptive levels</option>
                <option value="manual">Manual · dBFS</option>
              </select>
            </label>
            {draft.threshold !== null && (
              <label>
                Threshold (dBFS)
                <input
                  aria-label="OOK threshold dBFS"
                  type="number"
                  min="-90"
                  max="-5"
                  step="1"
                  value={draft.threshold}
                  onChange={(e) => set("threshold", e.target.valueAsNumber)}
                />
              </label>
            )}
            <label>
              Minimum pulse (µs)
              <input
                aria-label="OOK minimum pulse µs"
                type="number"
                min="25"
                max="5000"
                step="25"
                value={draft.minPulseUs}
                onChange={(e) => set("minPulseUs", e.target.valueAsNumber)}
              />
            </label>
            <label>
              Burst idle gap (µs)
              <input
                aria-label="OOK burst gap µs"
                type="number"
                min="1000"
                max="100000"
                step="100"
                value={draft.gapUs}
                onChange={(e) => set("gapUs", e.target.valueAsNumber)}
              />
            </label>
            <label>
              Interpretation
              <select
                aria-label="OOK bit interpretation"
                value={draft.encoding}
                onChange={(e) =>
                  set("encoding", e.target.value as OokOptions["encoding"])
                }
              >
                <option value="raw">Raw pulse timings</option>
                <option value="pwm">PWM · short 0 / long 1 high</option>
                <option value="ppm">PPM · short 0 / long 1 low</option>
                <option value="nrz">NRZ · fixed bit clock</option>
              </select>
            </label>
            {draft.encoding !== "raw" && (
              <>
                <label>
                  {draft.encoding === "nrz"
                    ? "Bit period (µs)"
                    : "Short duration (µs)"}
                  <input
                    aria-label="OOK short duration µs"
                    type="number"
                    min="25"
                    max="10000"
                    value={draft.shortUs}
                    onChange={(e) => set("shortUs", e.target.valueAsNumber)}
                  />
                </label>
                {draft.encoding !== "nrz" && (
                  <label>
                    Long duration (µs)
                    <input
                      aria-label="OOK long duration µs"
                      type="number"
                      min="25"
                      max="10000"
                      value={draft.longUs}
                      onChange={(e) => set("longUs", e.target.valueAsNumber)}
                    />
                  </label>
                )}
                <label className="checkbox-label ook-invert">
                  <input
                    aria-label="Invert OOK bits"
                    type="checkbox"
                    checked={draft.invert}
                    onChange={(e) => set("invert", e.target.checked)}
                  />
                  Invert interpreted bits
                </label>
              </>
            )}
          </div>
          <button className="button" type="submit">
            Apply OOK settings
          </button>
          <span className="caption">
            {" "}
            Changes restart pulse acquisition; stored bursts stay available.
          </span>
        </fieldset>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
      </form>
      <div className="ook-history-heading">
        <h3>
          Captured bursts <span>({captures.length} / 100)</span>
        </h3>
        <div className="ook-actions">
          <button
            className="button"
            disabled={!captures.length}
            onClick={() =>
              download(
                "ook-captures.json",
                JSON.stringify({ version: 1, captures }, null, 2),
                "application/json",
              )
            }
          >
            Export captures JSON
          </button>
          <button
            className="button"
            disabled={!captures.length}
            onClick={() => {
              setSelectedId(null);
              onClear();
            }}
          >
            Clear bursts
          </button>
        </div>
      </div>
      <label className="ook-capture-select">
        Inspect burst
        <select
          aria-label="Inspect OOK burst"
          value={selectedId ?? "latest"}
          onChange={(e) =>
            setSelectedId(
              e.target.value === "latest" ? null : Number(e.target.value),
            )
          }
        >
          <option value="latest">Follow latest burst</option>
          {captures.toReversed().map((c) => (
            <option value={c.id} key={c.id}>
              #{c.id} · {(c.frequency / 1e6).toFixed(4)} MHz ·{" "}
              {Math.ceil(c.durations.length / 2)} pulses ·{" "}
              {c.test ? "GENERATED" : "RF"} · {c.receivedAt}
            </option>
          ))}
        </select>
      </label>
      {!selected ? (
        <p className="ook-empty">
          No bursts yet. Tune a signal and start the receiver, or try the
          generated OOK test.
        </p>
      ) : (
        <>
          <div className="ook-burst-meta">
            <strong>
              {selected.test ? "GENERATED TEST" : "RF capture"} ·{" "}
              {(selected.frequency / 1e6).toFixed(4)} MHz ·{" "}
              {selected.bandwidth / 1000} kHz
            </strong>
            <span>
              {Math.ceil(selected.durations.length / 2)} pulses ·{" "}
              {((selected.endSeconds - selected.startSeconds) * 1000).toFixed(
                2,
              )}{" "}
              ms · {selected.receivedAt}
            </span>
          </div>
          <OokBurstViewer
            key={`${selected.id}:${options.encoding}:${options.shortUs}:${options.longUs}:${options.invert}`}
            capture={selected}
            options={options}
            showBytes={showBytes}
            onShowBytes={setShowBytes}
          />
          <div className="ook-actions">
            <button
              className="button"
              onClick={() =>
                download(
                  `burst-${selected.id}-${selected.test ? "test" : "rf"}.ook`,
                  ookText(selected),
                  "text/plain",
                )
              }
            >
              Export pulse data (.ook)
            </button>
          </div>
          <details>
            <summary>Raw pulse / gap durations (µs)</summary>
            <div className="ook-raw-scroll">
              <table className="ook-raw">
                <thead>
                  <tr>
                    <th>Pulse</th>
                    <th>High (µs)</th>
                    <th>Low (µs)</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.durations
                    .filter((_, i) => i % 2 === 0)
                    .map((high, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{high.toFixed(1)}</td>
                        <td>
                          {i * 2 + 2 === selected.durations.length &&
                          selected.gapLowerBound
                            ? "≥ "
                            : ""}
                          {selected.durations[i * 2 + 1]?.toFixed(1) ?? "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="caption">
            {selected.durations.length % 2
              ? "No following low gap was captured for the final high pulse."
              : selected.gapLowerBound
                ? "The last gap is an observed lower bound."
                : "All listed pulse and gap durations were captured."}{" "}
            The newest 100 bursts are kept in memory; export to save. Short
            glitches and oversized or unterminated bursts are discarded.
          </p>
        </>
      )}
    </section>
  );
}
