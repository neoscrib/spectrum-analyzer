import { useState } from "react";
import type { Settings } from "../model";
import type { ReplayState } from "../radio";
import { inspectCu8Replay, type IqReplayRequest } from "../recording/replay";
export function SpectrumReplay({
  settings,
  active,
  busy,
  replay,
  onReplay,
  onStop,
}: {
  settings: Settings;
  active: boolean;
  busy: boolean;
  replay: ReplayState | null;
  onReplay: (request: IqReplayRequest) => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [file, setFile] = useState<File>(),
    [metadata, setMetadata] = useState<File>();
  const [error, setError] = useState("");
  return (
    <section className="panel receiver-source" aria-label="Spectrum IQ replay">
      <h2>Spectrum IQ replay</h2>
      <p className="caption">
        Inspect full-band CU8 captures up to 20 MSPS. SigMF supplies the
        original center frequency and sample rate; raw files use the current
        settings.
      </p>
      <label>
        IQ recording
        <input
          type="file"
          aria-label="Spectrum IQ recording"
          accept=".cu8,.sigmf-data,.bin"
          disabled={active || busy}
          onChange={(e) => setFile(e.target.files?.[0])}
        />
      </label>
      <label>
        SigMF metadata
        <input
          type="file"
          aria-label="Spectrum replay metadata"
          accept=".sigmf-meta,.json"
          disabled={active || busy}
          onChange={(e) => setMetadata(e.target.files?.[0])}
        />
      </label>
      <button
        className="button"
        disabled={!file || active || busy}
        onClick={async () => {
          setError("");
          try {
            await onReplay(
              await inspectCu8Replay(file!, metadata, {
                ...settings,
                decoder: "none",
              }),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Replay spectrum IQ
      </button>
      {replay && (
        <p className="caption" role="status">
          {replay.phase === "complete"
            ? "Replay complete"
            : replay.phase === "playing"
              ? "Replaying"
              : "Replay stopped"}{" "}
          · {replay.seconds.toFixed(3)} s · {replay.sampleRate / 1e6} MSPS
        </p>
      )}
      {active && replay?.phase === "playing" && (
        <button className="button" onClick={() => void onStop()}>
          Stop spectrum replay
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
