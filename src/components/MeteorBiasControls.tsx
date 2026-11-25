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
  const mode = automatic
    ? !doppler
      ? "Automatic · waiting for Doppler"
      : !active
        ? "Automatic · ready"
        : !status?.automatic
          ? "Automatic · starting"
          : status.accepted && !status.fresh
            ? "Automatic · holding"
            : ready && status.fresh
              ? "Automatic · tracking"
              : "Automatic · acquiring"
    : status?.enabled && active
      ? "Manual · measuring"
      : ready
        ? "Manual · estimate ready"
        : "Manual";
  return (
    <section className="meteor-bias" aria-label="Frequency bias estimation">
      <div className="meteor-image-heading">
        <h3>Frequency bias</h3>
        <span className="chip" data-testid="meteor-bias-confidence">
          {mode}
        </span>
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
        Continuously estimate and correct frequency bias
      </label>
      <p className="caption">
        Measures throughout reception and replay, applies reliable corrections,
        and holds the current bias through weak signals.
      </p>
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
        <div>
          <span>Session corrections</span>
          <strong data-testid="meteor-bias-adjustments">
            {status?.adjustments ?? 0}
          </strong>
        </div>
      </div>
      <details open={!automatic}>
        <summary>Manual bias controls</summary>
        <p className="caption">
          Measure without changing the bias, then apply the estimate as manual
          tuning. During reception, turn off continuous correction first.
        </p>
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
      </details>
      <p className="caption" role="status">
        {!active
          ? adjusting
            ? "Continuous correction starts automatically with live reception or replay. No manual estimate is needed."
            : "Start live reception or replay a recording to measure the signal."
          : status?.enabled
            ? status.fresh
              ? status.reason
              : status.accepted
                ? "Waiting for reliable signal; applied correction is held. Measurement continues."
                : "Collecting reliable signal windows before applying a correction."
            : ready
              ? "Estimate retained. Apply it to the decoder or use it for the next replay."
              : status?.windows
                ? status.reason
                : "Estimate from several signal windows before applying a correction."}{" "}
        {automatic &&
          !doppler &&
          "Automatic correction needs orbital Doppler correction with a matching TLE to separate receiver bias from satellite motion. Manual estimation remains available and includes Doppler."}{" "}
        {adjusting &&
          "Automatic changes affect this decoder session; your saved manual bias is retained."}
      </p>
    </section>
  );
}
