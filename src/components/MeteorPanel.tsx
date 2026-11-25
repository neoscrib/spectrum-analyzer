import type { MeteorBiasCommand } from "../meteor/bias";
import { MeteorBiasControls } from "./MeteorBiasControls";
import { useEffect, useState, useRef } from "react";
import type { Settings } from "../model";
import type {
  MeteorOptions,
  MeteorStatus,
  ChannelImage,
  IqFormat,
} from "../meteor/model";
import { defaultLiveDoppler } from "../meteor/live-doppler";
import { referenceSettings } from "../meteor/model";
import type { ReplayOptions } from "../meteor/types";
import { DEFAULT_REPLAY, validateReplay } from "../meteor/replay";
import { inspectIq, type IqSource } from "../meteor/iq";
import { importMeteorProfile } from "../meteor/profile";
import { SATELLITES, validateSettings } from "../meteor/settings";
import { parseTle, predictPasses, tleAgeDays } from "../meteor/tracking";
import type { ReplayState } from "../radio";
import { MeteorConstellation } from "./MeteorConstellation";
import { MeteorImageChannel } from "./MeteorImageChannel";
import { MeteorPassList, type MeteorPassPrediction } from "./MeteorPassList";
export interface MeteorReplayRequest {
  file: File;
  source: IqSource;
  settings: Settings;
  options: ReplayOptions;
}
export function MeteorPanel({
  settings,
  status,
  images,
  constellation,
  source,
  busy,
  replay,
  onApply,
  onReplay,
  onBiasControl,
}: {
  settings: Settings;
  status: MeteorStatus | null;
  images: ChannelImage[];
  constellation: Float32Array | null;
  source: string;
  busy: boolean;
  replay: ReplayState | null;
  onApply: (options: MeteorOptions, frequency?: number) => Promise<boolean>;
  onReplay: (request: MeteorReplayRequest) => Promise<void>;
  onBiasControl: (command: MeteorBiasCommand) => void;
}) {
  const [draft, setDraft] = useState(settings.meteor),
    [error, setError] = useState("");
  const [enhance, setEnhance] = useState(false),
    [channel, setChannel] = useState(64);
  const [file, setFile] = useState<File | null>(null),
    [format, setFormat] = useState<IqFormat>("cu8"),
    [rate, setRate] = useState(2400000);
  const [center, setCenter] = useState(String(settings.center / 1e6)),
    [frequency, setFrequency] = useState(String(settings.channel / 1e6));
  const [options, setOptions] = useState<ReplayOptions>({ ...DEFAULT_REPLAY }),
    [expectedBytes, setExpectedBytes] = useState<number>();
  const [prediction, setPrediction] = useState<MeteorPassPrediction | null>(
    null,
  );
  const replayIntent = useRef(false);
  const metadataInput = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [fetching, setFetching] = useState(false);
  useEffect(() => {
    setDraft(settings.meteor);
    setCenter(String(settings.center / 1e6));
    setFrequency(String(settings.channel / 1e6));
  }, [settings.meteor, settings.center, settings.channel]);
  const patch = (p: Partial<MeteorOptions>) =>
    setDraft((d) => defaultLiveDoppler({ ...d, ...p }));
  const replaying = source === "replay";
  const selected = images.find((i) => i.apid === channel) ?? images[0];
  function biasCommand(command: MeteorBiasCommand) {
    const replayContext =
      source === "replay" || (source === "idle" && status?.bias?.replay);
    if (replayContext) {
      if (command.action === "apply")
        setOptions((o) => ({ ...o, frequencyOffsetHz: command.biasHz }));
      if (command.action === "auto")
        setOptions((o) => ({ ...o, autoBias: command.enabled }));
      if (source === "replay") onBiasControl(command);
    } else {
      if (command.action === "apply")
        patch({ frequencyBiasHz: command.biasHz });
      if (command.action === "auto") patch({ autoBias: command.enabled });
      onBiasControl(command);
    }
  }
  async function refreshTle() {
    setFetching(true);
    setError("");
    try {
      const response = await fetch(`/api/tle?id=${draft.satellite}`);
      if (!response.ok)
        throw Error(
          `TLE refresh failed (HTTP ${response.status}). You can paste orbital elements below.`,
        );
      const text = await response.text();
      parseTle(text, draft.satellite);
      patch({ tle: text });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }
  function predict() {
    try {
      const sat = parseTle(draft.tle, draft.satellite);
      setPrediction({
        passes: predictPasses(sat, draft, Date.now(), draft.minElevation),
        satellite: SATELLITES.find((s) => s.id === draft.satellite)!.name,
        orbit: sat,
        observer: {
          latitude: draft.latitude,
          longitude: draft.longitude,
          altitude: draft.altitude,
        },
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function applyOptions(frequency?: number) {
    try {
      const next = defaultLiveDoppler(draft);
      setDraft(next);
      if (next.doppler) {
        const sat = parseTle(next.tle, next.satellite);
        if (Math.abs(tleAgeDays(sat)) > 14)
          throw Error(
            "Refresh Meteor orbital elements before enabling live Doppler (TLE older than 14 days).",
          );
      }
      setError("");
      await onApply(next, frequency);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function loadMetadata(metadata: File | undefined) {
    if (!metadata) return;
    try {
      const profile = importMeteorProfile(JSON.parse(await metadata.text()), {
        ...settings,
        meteor: draft,
      });
      setDraft(profile.settings.meteor);
      setCenter(String(profile.settings.center / 1e6));
      setFrequency(String(profile.settings.channel / 1e6));
      setOptions(profile.options);
      setRate(profile.sampleRate);
      setFormat(profile.format);
      setExpectedBytes(profile.expectedBytes);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function startReplay(estimateBias = false) {
    if (!file || replayIntent.current) return;
    replayIntent.current = true;
    setPreparing(true);
    try {
      if (expectedBytes !== undefined && expectedBytes !== file.size)
        throw Error(
          "IQ byte count does not match the imported capture metadata.",
        );
      const s: Settings = {
        ...settings,
        decoder: "meteor",
        center: Number(center) * 1e6,
        channel: Number(frequency) * 1e6,
        bandwidth: 180000,
        meteor: draft,
      };
      if (file.name === "meteor_m2_72k.wav") {
        s.meteor = {
          ...draft,
          mode: "qpsk",
          nrzm: false,
          interleaved: false,
          symbolRate: 72000,
        };
        s.center = s.channel;
      }
      const source = await inspectIq(file, {
        ...referenceSettings(s),
        sampleRate: rate,
        replayFormat: format,
      });
      const r = referenceSettings(s, {
        sampleRate: source.sampleRate,
        format: source.format,
      });
      const problem = validateSettings(r) || validateReplay(options, r);
      if (problem) throw Error(problem);
      // Choosing the manual action explicitly requests a one-shot replay,
      // independently of the continuous replay default.
      if (estimateBias) setOptions((o) => ({ ...o, autoBias: false }));
      setError("");
      await onReplay({
        file,
        source,
        settings: s,
        options: {
          ...options,
          ...(estimateBias ? { estimateBias: true, autoBias: false } : {}),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      replayIntent.current = false;
      setPreparing(false);
    }
  }
  const numberField = (
    label: string,
    key:
      | "frequencyBiasHz"
      | "latitude"
      | "longitude"
      | "altitude"
      | "minElevation"
      | "reacquireSeconds",
  ) => (
    <label>
      {label}
      <input
        type="number"
        value={draft[key] ?? 0}
        onChange={(e) => patch({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  const fresh =
    status?.lastFrameSample !== null &&
    status?.lastFrameSample !== undefined &&
    status.samples - status.lastFrameSample < status.sampleRate * 2;
  return (
    <section className="meteor-panel" aria-label="Meteor-M decoder">
      <div className="section-heading">
        <div>
          <h2>
            Meteor-M <small>LRPT · WASM</small>
          </h2>
          <p className="caption">
            Shared I/Q → frequency correction → FIR / RRC → timing + carrier
            recovery → Viterbi / RS → packets → imagery
          </p>
        </div>
        <span className={`chip ${fresh ? "locked" : ""}`}>
          {source === "idle"
            ? "Stopped"
            : fresh
              ? "Frames synchronized"
              : status?.pll
                ? "Carrier tracking · awaiting frames"
                : "Acquiring"}
        </span>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="meteor-diagnostics">
        <MeteorConstellation data={constellation} />
        <div className="meteor-stat-grid" data-testid="meteor-stats">
          <div>
            <span>Frames · valid / rejected</span>
            <strong data-testid="meteor-frames">
              {status?.frames ?? 0} / {status?.badFrames ?? 0}
            </strong>
          </div>
          <div>
            <span>Packets / image strips</span>
            <strong data-testid="meteor-strips">
              {status?.packets ?? 0} / {status?.strips ?? 0}
            </strong>
          </div>
          <div>
            <span>Residual carrier / Doppler</span>
            <strong>
              {status
                ? `${status.carrier.toFixed(1)} / ${status.dopplerHz.toFixed(1)} Hz`
                : "—"}
            </strong>
          </div>
          <div>
            <span>RS corrections / JPEG rejects</span>
            <strong>
              {status?.corrected ?? 0} / {status?.jpegErrors ?? 0}
            </strong>
          </div>
          <div>
            <span>Viterbi metric / last RS result</span>
            <strong>
              {status?.viterbi ?? "—"} / {status?.rs ?? "—"}
            </strong>
          </div>
          <div>
            <span>Reacquisitions / buffered soft bits</span>
            <strong>
              {status?.reacquisitions ?? 0} / {status?.bufferedSoftBits ?? 0}
            </strong>
          </div>
          <div>
            <span>Input / elapsed sample time</span>
            <strong>
              {status
                ? `${(status.sampleRate / 1e6).toFixed(4)} MSPS · ${(status.samples / status.sampleRate).toFixed(1)} s`
                : "2.4 MSPS live"}
            </strong>
          </div>
          <div>
            <span>Digital tuning offset</span>
            <strong>{status ? `${status.offsetHz.toFixed(1)} Hz` : "—"}</strong>
          </div>
          {status?.captureTimeUtc && (
            <div>
              <span>Recorded sample UTC</span>
              <strong>{status.captureTimeUtc}</strong>
            </div>
          )}
          <div>
            <span>Last block DSP / WASM memory</span>
            <strong>
              {status
                ? `${status.decodeMs.toFixed(1)} ms · ${(status.memoryBytes / 1048576).toFixed(0)} MiB`
                : "—"}
            </strong>
          </div>
        </div>
      </div>
      <MeteorBiasControls
        status={status?.bias}
        active={source !== "idle"}
        canEstimateFile={Boolean(file)}
        onEstimateFile={() => void startReplay(true)}
        busy={busy || preparing}
        automatic={
          source === "replay" || (source === "idle" && status?.bias?.replay)
            ? (options.autoBias ?? true)
            : (settings.meteor.autoBias ?? true)
        }
        doppler={
          source === "replay" || (source === "idle" && status?.bias?.replay)
            ? Boolean(options.historicalDoppler)
            : settings.meteor.doppler
        }
        onCommand={biasCommand}
      />
      <details className="meteor-config">
        <summary>Transmission and Doppler settings</summary>
        <fieldset disabled={busy || replaying} className="meteor-form">
          <label>
            Satellite profile
            <select
              value={draft.satellite}
              onChange={(e) => {
                const satellite = Number(e.target.value);
                patch({
                  satellite,
                  mode: satellite === 40069 ? "qpsk" : "oqpsk",
                  nrzm: satellite !== 40069,
                  tle: "",
                });
              }}
            >
              {SATELLITES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modulation
            <select
              value={draft.mode}
              onChange={(e) =>
                patch({ mode: e.target.value as MeteorOptions["mode"] })
              }
            >
              <option value="oqpsk">OQPSK</option>
              <option value="qpsk">QPSK</option>
            </select>
          </label>
          <label>
            Symbol rate
            <select
              value={draft.symbolRate}
              onChange={(e) => patch({ symbolRate: Number(e.target.value) })}
            >
              <option value="72000">72 ksym/s</option>
              <option value="80000">
                80 ksym/s · experimental interleaving
              </option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.nrzm}
              onChange={(e) => patch({ nrzm: e.target.checked })}
            />
            NRZ-M differential transport
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.interleaved}
              onChange={(e) => patch({ interleaved: e.target.checked })}
            />
            Interleaved · experimental, unvalidated
          </label>
          {numberField("Live frequency bias (Hz)", "frequencyBiasHz")}
          <label>
            Live residual carrier range (Hz)
            <input
              type="number"
              placeholder="Default"
              value={draft.carrierLimitHz ?? ""}
              onChange={(e) =>
                patch({
                  carrierLimitHz:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          {numberField(
            "Live reacquire after no frames (s; 0 = off)",
            "reacquireSeconds",
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.doppler}
              onChange={(e) =>
                patch({
                  doppler: e.target.checked,
                  dopplerPreference: e.target.checked ? "on" : "off",
                })
              }
            />
            Live orbital Doppler correction
          </label>
          {numberField("Observer latitude (°)", "latitude")}
          {numberField("Observer longitude (°)", "longitude")}
          {numberField("Observer altitude (m)", "altitude")}
          {numberField("Minimum pass elevation (°)", "minElevation")}
          <label className="meteor-wide">
            Orbital elements (TLE)
            <textarea
              aria-label="Meteor orbital elements"
              rows={3}
              value={draft.tle}
              onChange={(e) => patch({ tle: e.target.value })}
            />
          </label>
          <div className="meteor-actions meteor-wide">
            <button
              className="button"
              disabled={fetching}
              onClick={() => void refreshTle()}
            >
              {fetching ? "Refreshing…" : "Refresh TLE"}
            </button>
            <button className="button" onClick={predict}>
              Predict passes
            </button>
            <button className="button" onClick={() => void applyOptions()}>
              Apply Meteor settings
            </button>
          </div>
          <div className="meteor-actions meteor-wide">
            Tune downlink:{" "}
            {[137100000, 137900000].map((hz) => (
              <button
                className="small"
                key={hz}
                onClick={() => void applyOptions(hz)}
              >
                {(hz / 1e6).toFixed(3)} MHz
              </button>
            ))}
          </div>
        </fieldset>
        <p className="caption">
          Verify the downlink and mode for your pass. Carrier tracking alone
          does not confirm LRPT; frame lock requires an attached sync marker and
          valid Reed–Solomon result. A matching TLE no more than 14 days old
          enables live Doppler by default when settings are applied. An explicit
          off choice is remembered. Verify your observer location before
          reception.
        </p>
        {prediction && prediction.passes.length > 0 && (
          <MeteorPassList prediction={prediction} />
        )}
      </details>
      <details className="meteor-replay">
        <summary>Replay recorded I/Q</summary>
        <fieldset
          disabled={busy || preparing || source !== "idle"}
          className="meteor-form"
        >
          <label className="meteor-wide">
            IQ recording
            <input
              aria-label="Meteor IQ recording"
              type="file"
              accept=".cu8,.cs16,.cf32,.wav,.raw,.iq,.sigmf-data"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError("");
              }}
            />
          </label>
          <label className="meteor-wide">
            Capture or recovery metadata (optional)
            <input
              ref={metadataInput}
              aria-label="Meteor replay metadata"
              type="file"
              accept=".json,.sigmf-meta"
              onChange={(e) => void loadMetadata(e.target.files?.[0])}
            />
          </label>
          <label>
            Raw IQ format
            <select
              aria-label="Meteor replay format"
              value={format}
              onChange={(e) => setFormat(e.target.value as IqFormat)}
            >
              <option value="cu8">CU8 · unsigned 8-bit</option>
              <option value="cs16">CS16 · little-endian signed 16-bit</option>
              <option value="cf32">CF32 · little-endian float32</option>
            </select>
          </label>
          <label>
            Raw sample rate (samples/s)
            <input
              aria-label="Meteor replay sample rate"
              type="number"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            />
          </label>
          <label>
            Recorded center (MHz)
            <input
              aria-label="Meteor recorded center"
              type="number"
              step="0.000001"
              value={center}
              onChange={(e) => setCenter(e.target.value)}
            />
          </label>
          <label>
            Downlink (MHz)
            <input
              aria-label="Meteor recorded downlink"
              type="number"
              step="0.000001"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            />
          </label>
          <label>
            Start (seconds)
            <input
              aria-label="Meteor replay start"
              type="number"
              value={options.startSeconds}
              onChange={(e) =>
                setOptions((o) => ({
                  ...o,
                  startSeconds: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Duration (seconds; blank = rest)
            <input
              aria-label="Meteor replay duration"
              type="number"
              value={options.durationSeconds ?? ""}
              onChange={(e) =>
                setOptions((o) => ({
                  ...o,
                  durationSeconds:
                    e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Replay frequency adjustment (Hz)
            <input
              aria-label="Meteor replay adjustment"
              type="number"
              value={options.frequencyOffsetHz}
              onChange={(e) =>
                setOptions((o) => ({
                  ...o,
                  frequencyOffsetHz: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Replay reacquisition timeout (s)
            <input
              aria-label="Meteor replay reacquisition"
              type="number"
              value={options.reacquireSeconds ?? 0}
              onChange={(e) =>
                setOptions((o) => ({
                  ...o,
                  reacquireSeconds: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Replay residual search (Hz; blank = default)
            <input
              aria-label="Meteor replay carrier range"
              type="number"
              value={options.carrierLimitHz ?? ""}
              onChange={(e) =>
                setOptions((o) => ({
                  ...o,
                  carrierLimitHz:
                    e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Original capture start (UTC)
            <input
              aria-label="Meteor capture UTC"
              value={options.recordingStartUtc ?? ""}
              onChange={(e) =>
                setOptions((o) => ({ ...o, recordingStartUtc: e.target.value }))
              }
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={options.historicalDoppler ?? false}
              onChange={(e) =>
                setOptions((o) => ({
                  ...o,
                  historicalDoppler: e.target.checked,
                }))
              }
            />
            Recorded orbital Doppler · original TLE + UTC
          </label>
          <label className="checkbox-label">
            <input
              aria-label="Automatically adjust replay bias"
              type="checkbox"
              checked={options.autoBias ?? true}
              onChange={(e) =>
                setOptions((o) => ({ ...o, autoBias: e.target.checked }))
              }
            />
            Continuously estimate and correct replay bias
          </label>
          <button
            className="button meteor-wide"
            onClick={() => {
              setExpectedBytes(undefined);
              setOptions({ ...DEFAULT_REPLAY });
              setRate(2400000);
              setFormat("cu8");
              setDraft(settings.meteor);
              setCenter(String(settings.center / 1e6));
              setFrequency(String(settings.channel / 1e6));
              setError("");
              if (metadataInput.current) metadataInput.current.value = "";
            }}
          >
            Reset replay controls
          </button>
          <button
            className="button meteor-wide"
            disabled={!file}
            onClick={() => void startReplay()}
          >
            {preparing ? "Preparing replay…" : "Replay Meteor IQ"}
          </button>
        </fieldset>
        <p className="caption">
          Streams locally through the same decoder at the file’s actual sample
          rate. WAV headers supply rate and format. Replay uses transmission
          settings above and its own frequency/reacquisition settings. Original
          capture time drives recorded Doppler, independent of replay speed.
          Live tuning is preserved.
        </p>
        {replay && (
          <p role="status" data-testid="meteor-replay-status">
            {replay.phase === "complete"
              ? "Replay complete"
              : replay.phase === "playing"
                ? "Replaying"
                : "Replay stopped"}{" "}
            · {replay.name} · {replay.seconds.toFixed(2)} s ·{" "}
            {((replay.bytes / replay.total) * 100).toFixed(1)}%
          </p>
        )}
      </details>
      <div className="meteor-image-heading">
        <h3>Satellite imagery</h3>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={enhance}
            onChange={(e) => setEnhance(e.target.checked)}
          />
          Enhance display contrast
        </label>
      </div>
      {images.length ? (
        <>
          <div
            className="meteor-channel-tabs"
            role="group"
            aria-label="Satellite image channels"
          >
            {images.map((i) => (
              <button
                className={`small ${selected?.apid === i.apid ? "active" : ""}`}
                key={i.apid}
                aria-pressed={selected?.apid === i.apid}
                onClick={() => setChannel(i.apid)}
              >
                CH {i.apid - 63} · {i.width} × {i.height}
              </button>
            ))}
          </div>
          {selected && (
            <MeteorImageChannel
              key={selected.apid}
              image={selected}
              enhance={enhance}
            />
          )}
        </>
      ) : (
        <p className="empty-state">
          Images appear incrementally after valid LRPT image packets arrive. Use
          your existing V-dipole for a satellite pass, or replay a compatible
          capture.
        </p>
      )}
      <p className="caption">
        Raw grayscale channels and optional contrast enhancement match the
        reference decoder. Each channel is bounded to 12,000 scan rows. Missing
        strips remain black; rejected JPEG packets are counted above. Channels
        can begin on different scan rows; images are not registered RGB
        composites, calibrated temperatures, or maps.{" "}
        <a
          href="/licenses/meteor-provenance.md"
          target="_blank"
          rel="noreferrer"
        >
          Decoder source and licenses
        </a>
      </p>
    </section>
  );
}
