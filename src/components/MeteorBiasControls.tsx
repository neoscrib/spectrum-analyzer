import type { MeteorBiasCommand, MeteorBiasStatus } from "../meteor/bias";
export function MeteorBiasControls({
  status,
  active,
  busy,
  automatic,
  doppler,
  onCommand,
  canEstimateFile,
  onEstimateFile,
}: {
  status: MeteorBiasStatus | undefined;
  active: boolean;
  busy: boolean;
  automatic: boolean;
  doppler: boolean;
  onCommand: (command: MeteorBiasCommand) => void;
  canEstimateFile: boolean;
  onEstimateFile: () => void;
}) {
  const adjusting = automatic && doppler;
  const ready =
    status?.hz !== null &&
    status?.hz !== undefined &&
    status.confidence === "high";
  return (
    <section className="meteor-bias" aria-label="Frequency bias estimation">
      <div className="meteor-image-heading">
        <h3>Frequency bias</h3>
        <span className="chip" data-testid="meteor-bias-confidence">
          {!active && status?.accepted
            ? "Last estimate"
            : status?.enabled
              ? status.confidence === "high"
                ? status.fresh
                  ? "High confidence"
                  : "Holding · signal weak"
                : "Measuring"
              : ready
                ? "Estimate ready"
                : "Idle"}
        </span>
      </div>
      <div className="meteor-stat-grid">
        <div>
          <span>
            {doppler
              ? "Estimated constant bias"
              : "Estimated offset · includes Doppler"}
          </span>
          <strong data-testid="meteor-bias-estimate">
            {status?.hz === null || status?.hz === undefined
              ? "—"
              : `${status.hz.toFixed(0)} Hz`}
          </strong>
        </div>
        <div>
          <span>Applied decoder bias</span>
          <strong data-testid="meteor-bias-applied">
            {status ? `${status.appliedHz.toFixed(0)} Hz` : "—"}
          </strong>
        </div>
        <div>
          <span>Reliable / measured windows</span>
          <strong>
            {status?.accepted ?? 0} / {status?.windows ?? 0}
          </strong>
        </div>
        <div>
          <span>Peak contrast / estimate spread</span>
          <strong>
            {status?.accepted
              ? `${status.contrastDb.toFixed(1)} dB / ${status.spreadHz.toFixed(1)} Hz`
              : "—"}
          </strong>
        </div>
      </div>
      <div className="meteor-actions">
        <button
          className="button"
          disabled={
            busy || (!active && !canEstimateFile) || (active && adjusting)
          }
          onClick={() => {
            if (!active) {
              onEstimateFile();
              return;
            }
            onCommand({ action: "estimate", enabled: !status?.enabled });
          }}
        >
          {status?.enabled && !adjusting
            ? "Stop estimating"
            : "Estimate frequency bias"}
        </button>
        <button
          className="button"
          disabled={busy || !ready}
          onClick={() => {
            if (status?.hz !== null && status?.hz !== undefined)
              onCommand({ action: "apply", biasHz: Math.round(status.hz) });
          }}
        >
          Apply estimated bias
        </button>
      </div>
      <label className="checkbox-label">
        <input
          aria-label="Automatically adjust frequency bias"
          type="checkbox"
          checked={automatic}
          disabled={busy}
          onChange={(e) =>
            onCommand({ action: "auto", enabled: e.target.checked })
          }
        />
        Automatically adjust frequency bias
      </label>
      <p className="caption" role="status">
        {!active
          ? "Start live reception or replay a recording to measure the signal."
          : status?.enabled
            ? status.fresh
              ? status.reason
              : "Waiting for reliable signal; applied correction is held."
            : ready
              ? "Estimate retained. Apply it to the decoder or use it for the next replay."
              : status?.windows
                ? status.reason
                : "Estimate from several signal windows before applying a correction."}{" "}
        {!doppler &&
          "Automatic correction waits for orbital Doppler setup. Manual estimation remains available and includes Doppler."}{" "}
        {adjusting &&
          "Automatic changes affect this decoder session; your saved manual bias is retained."}
      </p>
    </section>
  );
}
