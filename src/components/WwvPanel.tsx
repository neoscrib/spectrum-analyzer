import { Clock3, Radio } from "lucide-react";
import type { WwvStatus } from "../types";

export function WwvPanel({
  status,
  active,
  test,
  testSpeed,
}: {
  status: WwvStatus | null;
  active: boolean;
  test: boolean;
  testSpeed: number;
}) {
  const frame = status?.frame;
  const epoch = frame
    ? new Date(
        Date.UTC(frame.year, 0, frame.dayOfYear, frame.hour, frame.minute),
      )
    : null;
  const stale = !!status?.error || !active || !status?.synchronized;
  const stage = !active
    ? "Waiting for receiver"
    : status?.confirmed
      ? "Time code confirmed"
      : frame && !stale
        ? "Candidate · awaiting next minute"
        : status?.synchronized
          ? "Minute synchronized · collecting bits"
          : "Searching for minute synchronization";
  const symbols = status?.symbols ?? Array<number>(60).fill(-2);
  const label = (s: number) =>
    s === 2 ? "M" : s === -1 ? "—" : s === -2 ? "·" : String(s);
  return (
    <div className="wwv-panel" aria-label="WWV digital time code">
      <div className="wwv-heading">
        <h2>
          <Clock3 size={18} /> WWV digital time code
        </h2>
        <span
          className={
            status?.confirmed && active ? "wwv-stage confirmed" : "wwv-stage"
          }
        >
          {stage}
        </span>
      </div>
      {test && (
        <p className="wwv-test-label">
          <Radio size={14} /> Generated test transmission · fixed 2026-11-20
          fixture · {testSpeed}× ·{" "}
          {testSpeed > 1 ? "audio muted" : "audio available"}
        </p>
      )}
      <div className="wwv-readout">
        <div>
          <span className="field-label">
            {frame
              ? stale
                ? "Last decoded minute · sync lost"
                : frame.confirmed
                  ? "Confirmed frame start (UTC)"
                  : "Candidate frame start (UTC)"
              : "Decoded UTC minute"}
          </span>
          <time data-testid="wwv-time" dateTime={epoch?.toISOString()}>
            {epoch
              ? epoch.toISOString().slice(0, 16).replace("T", " ") + " UTC"
              : "Waiting for a valid frame"}
          </time>
          <p className="caption">
            Time is decoded from radio samples. The timestamp identifies the
            start of its one-minute frame.
          </p>
        </div>
        <div className="wwv-pulse">
          <span>Last 100 Hz pulse</span>
          <strong>
            {status?.pulseMs ? `${Math.round(status.pulseMs)} ms` : "—"}
          </strong>
          <small>
            {status
              ? status.symbol === 2
                ? "Position marker"
                : status.symbol >= 0
                  ? `Binary ${status.symbol}`
                  : "Unclassified / no pulse"
              : "No pulse measured"}
          </small>
        </div>
      </div>
      <div className="wwv-bits" aria-label="Received 60-second frame">
        {symbols.map((s, i) => (
          <span
            key={i}
            title={`Second ${i}: ${s === 2 ? "marker" : s === -1 ? "minute gap" : s === -2 ? "not received" : `bit ${s}`}`}
            className={`symbol symbol-${s === -2 ? "unknown" : s === -1 ? "gap" : s === 2 ? "marker" : s} ${status?.second === i ? "current" : ""}`}
          >
            <small>{i.toString().padStart(2, "0")}</small>
            <b>{label(s)}</b>
          </span>
        ))}
      </div>
      <div className="wwv-legend">
        <span>0 ≈ 170 ms</span>
        <span>1 ≈ 470 ms</span>
        <span>M ≈ 770 ms</span>
        <span>— minute-reference gap</span>
      </div>
      <div className="wwv-data">
        <div>
          <span>Day of year</span>
          <strong>{frame?.dayOfYear ?? "—"}</strong>
        </div>
        <div>
          <span>DUT1</span>
          <strong>
            {frame
              ? `${frame.dut1 >= 0 ? "+" : ""}${frame.dut1.toFixed(1)} s`
              : "—"}
          </strong>
        </div>
        <div>
          <span>DST bits #1 / #2</span>
          <strong>
            {frame ? `${Number(frame.dst1)} / ${Number(frame.dst2)}` : "—"}
          </strong>
        </div>
        <div>
          <span>Leap warning</span>
          <strong>{frame ? (frame.leapWarning ? "Yes" : "No") : "—"}</strong>
        </div>
        <div>
          <span>Valid / rejected</span>
          <strong>
            {status
              ? `${status.validFrames} / ${status.rejectedFrames}`
              : "0 / 0"}
          </strong>
        </div>
      </div>
      <p className="caption">
        {status?.error ? `Acquisition: ${status.error}. ` : ""}Two consecutive
        valid minute frames are required for confirmation. Allow up to about
        three minutes from an arbitrary start. Year assumes 2000–2099; no
        computer-clock correction is applied.
      </p>
    </div>
  );
}
