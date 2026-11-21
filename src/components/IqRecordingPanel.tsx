import { Circle, Download, Square } from "lucide-react";
import { useState } from "react";
import {
  BYTE_RATE,
  MEMORY_LIMIT,
  metadataName,
  type RecordingState,
} from "../recording/model";
import { canStreamToFolder, downloadBlob } from "../recording/storage";
const size = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
export function IqRecordingPanel({
  state,
  active,
  busy,
  preparing,
  onStart,
  onStop,
  onClear,
}: {
  state: RecordingState;
  active: boolean;
  busy: boolean;
  preparing: boolean;
  onStart: (mode: "disk" | "download", seconds: number) => Promise<void>;
  onStop: () => Promise<void>;
  onClear: () => void;
}) {
  const folderAvailable = canStreamToFolder();
  const [mode, setMode] = useState<"disk" | "download">(
    folderAvailable ? "disk" : "download",
  );
  const [seconds, setSeconds] = useState(10);
  const locked =
    preparing || state.phase === "recording" || state.phase === "saving";
  const result = state.phase === "complete" || state.phase === "error";
  return (
    <section className="panel iq-panel" aria-label="IQ recording">
      <div className="panel-title">
        <h2>
          <Circle
            size={16}
            className={state.phase === "recording" ? "iq-rec-dot" : ""}
          />{" "}
          IQ recording
        </h2>
        <span className="chip">CU8</span>
      </div>
      <p className="caption">
        Full 2.4 MHz capture · 2.4 MSPS · {size(BYTE_RATE)}/s (
        {size(BYTE_RATE * 60)}/min).
      </p>
      <label className="field-label" htmlFor="iq-storage">
        Save destination
      </label>
      <select
        id="iq-storage"
        value={mode}
        disabled={locked}
        onChange={(e) => setMode(e.target.value as typeof mode)}
      >
        <option value="disk" disabled={!folderAvailable}>
          Folder · stream to disk
        </option>
        <option value="download">Download · up to 64 MiB</option>
      </select>
      <label className="field-label" htmlFor="iq-duration">
        Recording duration
      </label>
      <select
        id="iq-duration"
        value={seconds}
        disabled={locked}
        onChange={(e) => setSeconds(Number(e.target.value))}
      >
        <option value="2">2 seconds · 9.6 MB</option>
        <option value="5">5 seconds · 24 MB</option>
        <option value="10">10 seconds · 48 MB</option>
        <option value="30">30 seconds · 144 MB</option>
        <option value="60">1 minute · 288 MB</option>
        <option value="300">5 minutes · 1.44 GB</option>
        <option value="0">Until stopped</option>
      </select>
      <p className="caption iq-storage-note">
        {mode === "disk"
          ? "Choose a folder once for this capture. IQ and SigMF metadata are saved together when recording finishes."
          : `Kept in memory until downloaded. Stops at ${size(MEMORY_LIMIT)} (about ${(MEMORY_LIMIT / BYTE_RATE).toFixed(1)} seconds), even if a longer duration is selected.`}
      </p>
      {state.phase === "recording" ? (
        <button className="button stop-button" onClick={() => void onStop()}>
          <Square size={14} fill="currentColor" />
          Stop IQ recording
        </button>
      ) : (
        <button
          className="button"
          disabled={!active || busy || locked}
          onClick={() => void onStart(mode, seconds)}
        >
          <Circle size={14} />
          {preparing
            ? "Choosing folder…"
            : state.phase === "saving"
              ? "Saving IQ…"
              : result
                ? "New IQ recording"
                : "Record IQ"}
        </button>
      )}
      <div className="iq-progress" role="status" aria-live="polite">
        <strong data-testid="iq-recording-status">
          {preparing
            ? "Choosing save destination"
            : state.phase === "recording"
              ? "Recording"
              : state.phase === "saving"
                ? "Finishing file…"
                : state.phase === "complete"
                  ? state.mode === "disk"
                    ? "Saved to chosen folder"
                    : "Ready to download"
                  : state.phase === "error"
                    ? "Save needs attention"
                    : active
                      ? "Ready"
                      : "Start a source to record"}
        </strong>
        {state.info && (
          <>
            <span>
              {state.info.source === "test"
                ? "GENERATED TEST IQ"
                : "Live RF IQ"}{" "}
              · {(state.info.settings.center / 1e6).toFixed(4)} MHz
            </span>
            <span data-testid="iq-recording-size">
              {(state.bytes / BYTE_RATE).toFixed(3)} s · {size(state.bytes)}
              {state.phase === "recording" || state.phase === "saving"
                ? ` · ${size(state.queued)} pending`
                : ""}
            </span>
            <span className="iq-filename">{state.info.filename}</span>
          </>
        )}
      </div>
      {result && (
        <>
          <p
            className={`caption iq-result ${state.phase === "error" ? "iq-error" : ""}`}
            role={state.phase === "error" ? "alert" : undefined}
          >
            {state.reason}
          </p>
          <div className="iq-downloads">
            {state.blob && (
              <button
                className="button"
                onClick={() => downloadBlob(state.info!.filename, state.blob!)}
              >
                <Download size={14} /> Download IQ (.cu8)
              </button>
            )}
            {state.metadata && (
              <button
                className="button"
                onClick={() =>
                  downloadBlob(
                    metadataName(state.info!.filename),
                    new Blob([state.metadata!], { type: "application/json" }),
                  )
                }
              >
                <Download size={14} /> Download SigMF metadata
              </button>
            )}
            <button className="button" onClick={onClear}>
              {state.mode === "download"
                ? "Discard capture"
                : "Clear recording status"}
            </button>
          </div>
          {state.blob && (
            <p className="caption">
              Download both files before starting another capture or closing
              this tab.
            </p>
          )}
        </>
      )}
      <p className="caption iq-scope">
        Records raw I/Q before decoder filtering. Display zoom, view freeze, and
        audio playback do not affect it. Scanning pauses on the current RF
        window while recording. Applying receiver or decoder settings finishes
        this file. Stop recording and wait for saving before closing this tab.
      </p>
    </section>
  );
}
