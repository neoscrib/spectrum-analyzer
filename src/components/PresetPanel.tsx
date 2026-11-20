import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Upload,
  Radio,
  Plus,
  ScanLine,
  Pause,
  Play,
} from "lucide-react";
import { decoders, SAMPLE_RATE, type Settings } from "../model";
import {
  captureWindows,
  loadLibrary,
  presetSettings,
  starterLibrary,
  toneLabel,
  validateLibrary,
  type PresetLibrary,
  type FrequencyPreset,
  type NfmFeed,
  type NfmMonitorConfig,
  type ActivityRecord,
} from "../presets/model";
import { SquelchSelect, ToneSelect } from "./ToneSelect";
interface Props {
  settings: Settings;
  source: "idle" | "live" | "test";
  busy: boolean;
  feed: NfmFeed;
  generation: number;
  applied: NfmMonitorConfig | null;
  onTune: (preset: FrequencyPreset) => Promise<boolean>;
  onMonitor: (config: NfmMonitorConfig, center: number) => Promise<boolean>;
  onStopMonitor: () => Promise<boolean>;
  onHold: (id: string | null) => void;
}
const uid = () => crypto.randomUUID();
function loadHistory(): ActivityRecord[] {
  try {
    const data = JSON.parse(
      localStorage.getItem("spectrum-activity-v1") ?? "[]",
    );
    return Array.isArray(data)
      ? data
          .filter(
            (r) =>
              r &&
              typeof r.id === "string" &&
              typeof r.name === "string" &&
              r.name.length <= 120 &&
              typeof r.presetId === "string" &&
              Number.isFinite(r.frequency) &&
              Number.isFinite(r.started) &&
              Number.isFinite(r.duration) &&
              r.test === false,
          )
          .slice(0, 300)
          .map((r) => ({ ...r, end: r.end === "active" ? "stopped" : r.end }))
      : [];
  } catch {
    return [];
  }
}
const download = (filename: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function PresetPanel({
  settings,
  source,
  busy,
  feed,
  generation,
  applied,
  onTune,
  onMonitor,
  onStopMonitor,
  onHold,
}: Props) {
  const [library, setLibrary] = useState(loadLibrary),
    [bankId, setBankId] = useState("frs-gmrs");
  const [scan, setScan] = useState(false),
    [pending, setPending] = useState(false),
    [windowIndex, setWindowIndex] = useState(0);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [newBank, setNewBank] = useState("");
  const [editor, setEditor] = useState<FrequencyPreset | null>(null),
    [editFrequency, setEditFrequency] = useState("");
  const [history, setHistory] = useState<ActivityRecord[]>(loadHistory);
  const historyRef = useRef(history);
  historyRef.current = history;
  const activeRecords = useRef(
    new Map<string, { id: string; start: number }>(),
  );
  const bank = library.banks.find((b) => b.id === bankId) ?? library.banks[0];
  const windows = useMemo(() => captureWindows(bank), [bank]);
  const configKey = JSON.stringify(
    windows.map((w) => [w.key, w.center, w.presets.map(({ name, ...p }) => p)]),
  );
  const status = feed.status;
  const bankRef = useRef(bank);
  bankRef.current = bank;
  useEffect(() => {
    try {
      localStorage.setItem("spectrum-presets-v1", JSON.stringify(library));
    } catch {
      setError(
        "Preset storage is unavailable. Export JSON to save your banks.",
      );
    }
  }, [library]);
  useEffect(() => {
    const timer = setInterval(() => {
      try {
        localStorage.setItem(
          "spectrum-activity-v1",
          JSON.stringify(historyRef.current.filter((r) => !r.test)),
        );
      } catch {
        /* History is optional. */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const entries = historyRef.current.map((r) => ({ ...r }));
    for (const e of feed.events) {
      if (e.open && !activeRecords.current.has(e.id)) {
        const preset = bankRef.current.presets.find(
          (p) =>
            p.id === e.id ||
            (p.decoder === "nfm" && p.frequency === e.frequency),
        );
        const record: ActivityRecord = {
          id: uid(),
          presetId: e.id,
          name: preset?.name ?? "Manual NFM",
          frequency: e.frequency,
          started: Date.now(),
          duration: 0,
          level: e.level,
          code: e.ctcss || e.dcs.length ? toneLabel(e.ctcss, e.dcs) : "",
          test: source === "test",
          end: "active",
        };
        entries.unshift(record);
        activeRecords.current.set(e.id, { id: record.id, start: e.seconds });
      }
      if (!e.open) {
        const a = activeRecords.current.get(e.id);
        const record = entries.find((r) => r.id === a?.id);
        if (a && record) {
          record.duration = Math.max(0, e.seconds - a.start);
          record.end = "squelch";
        }
        activeRecords.current.delete(e.id);
      }
    }
    for (const ch of feed.status?.channels ?? []) {
      const a = activeRecords.current.get(ch.id),
        record = entries.find((r) => r.id === a?.id);
      if (a && record) {
        record.duration = Math.max(0, ch.seconds - a.start);
        record.level = Math.max(record.level, ch.level);
        if (ch.ctcss || ch.dcs.length)
          record.code = toneLabel(ch.ctcss, ch.dcs);
      }
    }
    historyRef.current = entries.slice(0, 300);
    setHistory(historyRef.current);
  }, [feed]);
  useEffect(() => {
    if (!activeRecords.current.size) return;
    const entries = historyRef.current.map((r) =>
      r.end === "active"
        ? {
            ...r,
            end:
              source === "idle" ? ("stopped" as const) : ("retuned" as const),
          }
        : r,
    );
    activeRecords.current.clear();
    historyRef.current = entries;
    setHistory(entries);
  }, [generation, source]);
  const switchWindow = async (index: number) => {
    const window = windows[index];
    if (!window || pending || busy) return;
    setPending(true);
    setError("");
    try {
      const ok = await onMonitor(
        {
          bankId: bank.id,
          windowKey: window.key,
          presets: window.presets,
          holdId: null,
        },
        window.center,
      );
      if (ok) {
        setWindowIndex(index);
        setScan(true);
      } else setScan(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setScan(false);
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    if (!scan || pending || busy) return;
    if (
      source === "idle" ||
      settings.decoder !== "nfm" ||
      applied?.bankId !== bank.id
    ) {
      setScan(false);
      return;
    }
    if (
      !status ||
      status.windowKey !== applied.windowKey ||
      applied.holdId ||
      windows.length < 2
    )
      return;
    if (status.seconds >= 0.75 && !status.channels.some((ch) => ch.carrier))
      void switchWindow((windowIndex + 1) % windows.length);
  }, [
    scan,
    pending,
    busy,
    source,
    settings.decoder,
    applied,
    status,
    windowIndex,
    windows,
  ]);
  const previousConfig = useRef(configKey);
  useEffect(() => {
    if (previousConfig.current === configKey) return;
    if (scan && (pending || busy)) return;
    previousConfig.current = configKey;
    if (scan && !pending && !busy) {
      if (windows.length)
        void switchWindow(Math.min(windowIndex, windows.length - 1));
      else {
        setScan(false);
        void onStopMonitor();
      }
    }
  }, [configKey, scan, pending, busy]);
  const updateBank = (presets: FrequencyPreset[]) => {
    const next = {
      ...library,
      banks: library.banks.map((b) =>
        b.id === bank.id ? { ...b, presets } : b,
      ),
    };
    validateLibrary(next);
    setLibrary(next);
  };
  const edit = (preset: FrequencyPreset) => {
    setEditor({ ...preset });
    setEditFrequency((preset.frequency / 1e6).toFixed(4));
  };
  const add = () =>
    edit({
      id: uid(),
      name: "New frequency",
      frequency: settings.channel,
      decoder: ["nfm", "am", "wfm"].includes(settings.decoder)
        ? (settings.decoder as FrequencyPreset["decoder"])
        : "nfm",
      bandwidth: ["nfm", "am", "wfm"].includes(settings.decoder)
        ? settings.bandwidth
        : 12500,
      deviation: settings.nfmDeviation,
      squelch: settings.squelch,
      tone: settings.tone,
      enabled: true,
    });
  const save = () => {
    if (!editor) return;
    try {
      const p = {
        ...editor,
        frequency: Math.round(Number(editFrequency) * 1e6),
      };
      updateBank([...bank.presets.filter((p) => p.id !== editor.id), p]);
      setEditor(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const stop = async () => {
    setScan(false);
    setPending(true);
    await onStopMonitor();
    setPending(false);
  };
  const selected = bank.presets.find((p) => p.id === status?.selectedId);
  return (
    <section className="preset-panel panel" aria-label="Frequency presets">
      <div className="preset-heading">
        <div>
          <div className="eyebrow">FREQUENCY BANKS</div>
          <h2>
            <Radio size={19} /> Tune, monitor, explore.
          </h2>
          <p>Saved channels with their own decoder, filter, and squelch.</p>
        </div>
        <div className="preset-actions">
          <button
            onClick={() =>
              download(
                "spectrum-presets.json",
                JSON.stringify(library, null, 2),
                "application/json",
              )
            }
          >
            <Download size={14} /> Export banks
          </button>
          <label className="preset-file">
            <Upload size={14} /> Import banks
            <input
              aria-label="Import preset banks"
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  if (file.size > 1024 * 1024)
                    throw Error("Use a preset library smaller than 1 MB.");
                  const value = JSON.parse(await file.text());
                  validateLibrary(value);
                  if (scan) await stop();
                  setLibrary(value);
                  setBankId(value.banks[0].id);
                  setNotice("Imported preset library.");
                  setError("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          </label>
        </div>
      </div>
      <div className="preset-toolbar">
        <label className="preset-field">
          Radio service / bank
          <select
            aria-label="Radio service / bank"
            value={bank.id}
            disabled={scan || pending}
            onChange={(e) => {
              setBankId(e.target.value);
              setQuery("");
              setEditor(null);
            }}
          >
            {library.banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="Search frequency presets"
          placeholder="Search channels or frequencies…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={add} disabled={pending}>
          <Plus size={14} /> Save frequency
        </button>
        {scan ? (
          <>
            <button onClick={() => void stop()} disabled={busy || pending}>
              Stop monitoring
            </button>
            <button
              disabled={
                busy || pending || (!status?.selectedId && !applied?.holdId)
              }
              onClick={() =>
                onHold(applied?.holdId ? null : (status?.selectedId ?? null))
              }
            >
              {applied?.holdId ? <Play size={14} /> : <Pause size={14} />}{" "}
              {applied?.holdId ? "Resume scan" : "Hold channel"}
            </button>
            {windows.length > 1 && (
              <button
                disabled={busy || pending}
                onClick={() =>
                  void switchWindow((windowIndex + 1) % windows.length)
                }
              >
                Next window
              </button>
            )}
          </>
        ) : (
          <button
            className="preset-monitor"
            disabled={busy || pending || !windows.length}
            onClick={() => void switchWindow(0)}
          >
            <ScanLine size={15} />
            {pending ? "Starting…" : "Monitor / scan bank"}
          </button>
        )}
      </div>
      <div
        className={`preset-monitor-status ${scan ? "monitoring" : ""}`}
        role="status"
        data-testid="preset-monitor-status"
      >
        {pending
          ? "Applying capture window…"
          : scan
            ? `${applied?.holdId ? "Holding channel" : status?.channels.some((c) => c.carrier) ? "Activity · holding RF window" : "Scanning"} · window ${windowIndex + 1} / ${windows.length} · ${applied?.presets.length ?? 0} parallel receivers${selected ? ` · selected ${selected.name}` : ""}`
            : `${bank.presets.length} presets · ${windows.length} capture window${windows.length === 1 ? "" : "s"} for enabled NFM channels`}
      </div>
      <p className="caption">
        One active channel plays at a time. All enabled NFM channels in the
        current window are monitored together; other windows are unobserved
        until the tuner switches. Carrier activity holds the window. AM/WFM
        presets support individual tuning.
      </p>
      {source === "test" && (
        <p className="preset-test-label">
          TEST SOURCE · Generated activity is labelled and excluded from saved
          RF history.
        </p>
      )}
      {editor && (
        <form
          className="preset-editor"
          aria-label="Preset editor"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <h3>
            {bank.presets.some((p) => p.id === editor.id)
              ? "Edit preset"
              : "Save frequency preset"}
          </h3>
          <div className="preset-editor-grid">
            <label className="preset-field">
              Preset name
              <input
                aria-label="Preset name"
                value={editor.name}
                maxLength={120}
                required
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
            </label>
            <label className="preset-field">
              Frequency (MHz)
              <input
                aria-label="Preset frequency MHz"
                type="number"
                min="24"
                max="1766"
                step="0.0001"
                value={editFrequency}
                onChange={(e) => setEditFrequency(e.target.value)}
                required
              />
            </label>
            <label className="preset-field">
              Modulation
              <select
                aria-label="Preset modulation"
                value={editor.decoder}
                onChange={(e) => {
                  const decoder = e.target.value as FrequencyPreset["decoder"];
                  setEditor({
                    ...editor,
                    decoder,
                    bandwidth: decoders.find((d) => d.id === decoder)!
                      .requirements.bandwidthHz,
                  });
                }}
              >
                {["nfm", "am", "wfm"].map((d) => (
                  <option key={d} value={d}>
                    {d.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="preset-field">
              Filter width
              <select
                aria-label="Preset filter width"
                value={editor.bandwidth}
                onChange={(e) =>
                  setEditor({ ...editor, bandwidth: Number(e.target.value) })
                }
              >
                {decoders
                  .find((d) => d.id === editor.decoder)!
                  .bandwidths.map((w) => (
                    <option key={w} value={w}>
                      {w / 1000} kHz
                    </option>
                  ))}
              </select>
            </label>
            {editor.decoder === "nfm" && (
              <>
                <SquelchSelect
                  value={editor.squelch}
                  onChange={(squelch) => setEditor({ ...editor, squelch })}
                  label="Preset squelch"
                />
                <label className="preset-field">
                  FM deviation
                  <select
                    aria-label="Preset FM deviation"
                    value={editor.deviation}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        deviation: Number(e.target.value),
                      })
                    }
                  >
                    {[2500, 5000, 7500].map((v) => (
                      <option key={v} value={v}>
                        ±{v / 1000} kHz
                      </option>
                    ))}
                  </select>
                </label>
                <ToneSelect
                  value={editor.tone}
                  onChange={(tone) => setEditor({ ...editor, tone })}
                  label="Preset code filter"
                />
              </>
            )}
          </div>
          <div className="preset-actions">
            <button className="preset-monitor" type="submit">
              Save preset
            </button>
            <button type="button" onClick={() => setEditor(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="preset-table-scroll">
        <table className="preset-table">
          <thead>
            <tr>
              <th>Scan</th>
              <th>Channel / preset</th>
              <th>Frequency</th>
              <th>Decoder / filter</th>
              <th>Current window</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bank.presets
              .filter((p) =>
                `${p.name} ${p.frequency / 1e6}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((p) => {
                const measured =
                  scan && status?.windowKey === applied?.windowKey
                    ? status?.channels.find((c) => c.id === p.id)
                    : !scan && p.frequency === settings.channel
                      ? status?.channels[0]
                      : undefined;
                return (
                  <tr
                    key={p.id}
                    className={
                      scan && status?.selectedId === p.id
                        ? "preset-selected"
                        : ""
                    }
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Scan ${p.name}`}
                        checked={p.enabled}
                        disabled={p.decoder !== "nfm" || pending || busy}
                        onChange={(e) => {
                          try {
                            updateBank(
                              bank.presets.map((old) =>
                                old.id === p.id
                                  ? { ...old, enabled: e.target.checked }
                                  : old,
                              ),
                            );
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="preset-name-button"
                        aria-label={`Tune ${p.name}`}
                        disabled={busy || pending}
                        onClick={() => {
                          setScan(false);
                          void onTune(p);
                        }}
                      >
                        {p.name}
                      </button>
                      {p.tone && (
                        <small>
                          {p.tone.type === "ctcss"
                            ? `${p.tone.hz} Hz filter`
                            : `${p.tone.code}${p.tone.inverted ? "I" : "N"} filter`}
                        </small>
                      )}
                    </td>
                    <td className="mono">
                      {(p.frequency / 1e6).toFixed(4)}
                      <small>MHz</small>
                    </td>
                    <td>
                      {p.decoder.toUpperCase()} · {p.bandwidth / 1000} kHz
                      <small>
                        {p.decoder === "nfm"
                          ? p.squelch === null
                            ? "Squelch off"
                            : `${p.squelch} dBFS`
                          : "Tune individually"}
                      </small>
                    </td>
                    <td>
                      {measured ? (
                        <>
                          <span>
                            {measured.open
                              ? "Open"
                              : measured.carrier
                                ? "Code mismatch"
                                : "Quiet"}{" "}
                            · {measured.level.toFixed(0)} dBFS
                          </span>
                          <small>
                            {toneLabel(measured.ctcss, measured.dcs)}
                          </small>
                        </>
                      ) : (
                        <span className="muted">
                          {scan ? "Not in current window" : "—"}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="preset-row-actions">
                        <button
                          aria-label={`Tune ${p.name} frequency`}
                          disabled={busy || pending}
                          onClick={() => {
                            setScan(false);
                            void onTune(p);
                          }}
                        >
                          Tune
                        </button>
                        <button disabled={pending} onClick={() => edit(p)}>
                          Edit
                        </button>
                        <button
                          disabled={pending}
                          aria-label={`Delete ${p.name}`}
                          onClick={() =>
                            updateBank(
                              bank.presets.filter((old) => old.id !== p.id),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {!bank.presets.length && (
          <p className="caption">
            Save your current frequency or add a channel to this bank.
          </p>
        )}
      </div>
      <div className="preset-bank-tools">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newBank.trim()) return;
            try {
              const bank = { id: uid(), name: newBank.trim(), presets: [] };
              const next = { ...library, banks: [...library.banks, bank] };
              validateLibrary(next);
              setLibrary(next);
              setBankId(bank.id);
              setNewBank("");
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <input
            aria-label="New bank name"
            maxLength={100}
            placeholder="New custom bank name"
            value={newBank}
            onChange={(e) => setNewBank(e.target.value)}
            required
            disabled={scan}
          />
          <button disabled={scan}>Create bank</button>
        </form>
        {bank.source && (
          <a
            href={bank.source.startsWith("https://") ? bank.source : undefined}
            target="_blank"
            rel="noreferrer"
          >
            Channel reference ↗
          </a>
        )}
        <button
          disabled={scan || pending}
          onClick={() => {
            const original = starterLibrary().banks.find(
              (b) => b.id === bank.id,
            );
            if (original)
              setLibrary({
                ...library,
                banks: library.banks.map((b) =>
                  b.id === bank.id ? original : b,
                ),
              });
            else if (library.banks.length > 1) {
              setLibrary({
                ...library,
                banks: library.banks.filter((b) => b.id !== bank.id),
              });
              setBankId(
                library.banks[0].id === bank.id
                  ? library.banks[1].id
                  : library.banks[0].id,
              );
            }
          }}
        >
          {starterLibrary().banks.some((b) => b.id === bank.id)
            ? "Reset this bank"
            : "Delete bank"}
        </button>
      </div>
      <details className="preset-history" open>
        <summary>Activity history · {history.length} observations</summary>
        <div className="preset-actions">
          <button
            onClick={() => {
              const cell = (v: string) =>
                '"' +
                (/^[=+@\-\t\r]/.test(v) ? "'" : "") +
                v.replaceAll('"', '""') +
                '"';
              download(
                "spectrum-activity.csv",
                [
                  "Started,Channel,Frequency Hz,Observed seconds,Peak dBFS,Code,Source,End",
                  ...history.map((r) =>
                    [
                      new Date(r.started).toISOString(),
                      cell(r.name),
                      r.frequency,
                      r.duration.toFixed(3),
                      r.level.toFixed(1),
                      cell(r.code),
                      r.test ? "generated test" : "RF",
                      r.end,
                    ].join(","),
                  ),
                ].join("\n"),
                "text/csv",
              );
            }}
          >
            Export activity CSV
          </button>
          <button
            onClick={() => {
              activeRecords.current.clear();
              historyRef.current = [];
              setHistory([]);
              try {
                localStorage.removeItem("spectrum-activity-v1");
              } catch {}
            }}
          >
            Clear history
          </button>
        </div>
        <ol>
          {history.slice(0, 60).map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <span>
                  {new Date(r.started).toLocaleTimeString()} ·{" "}
                  {(r.frequency / 1e6).toFixed(4)} MHz
                </span>
              </div>
              <div>
                <strong>
                  {r.duration.toFixed(1)} s ·{" "}
                  {r.end === "active"
                    ? "active"
                    : r.end === "squelch"
                      ? "closed"
                      : r.end === "retuned"
                        ? "observation interrupted"
                        : "stopped"}
                </strong>
                <span>
                  {r.code || "No code detected"}
                  {r.test ? " · GENERATED TEST" : " · RF"}
                </span>
              </div>
            </li>
          ))}
        </ol>
        {!history.length && (
          <p className="caption">
            Carrier openings will appear here. Durations measure observed
            activity; retuning or stopping ends an observation without claiming
            the transmission ended.
          </p>
        )}
      </details>
      {error && (
        <p className="armer-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="armer-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
