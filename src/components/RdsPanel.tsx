import { useState } from "react";
import {
  broadcastClock,
  ptyLabel,
  type RdsRegion,
  type RdsStatus,
} from "../rds/model";

export function RdsPanel({
  status,
  enabled,
  active,
  test,
}: {
  status: RdsStatus | null;
  enabled: boolean;
  active: boolean;
  test: boolean;
}) {
  const [region, setRegion] = useState<RdsRegion>(() => {
    try {
      return localStorage.getItem("spectrum-rds-region") === "rds"
        ? "rds"
        : "rbds";
    } catch {
      return "rbds";
    }
  });
  const receiving = enabled && active && !!status?.synchronized;
  const state = !enabled
    ? "Disabled"
    : !active
      ? "Stopped"
      : receiving
        ? "Receiving"
        : status?.pi !== null && status?.pi !== undefined
          ? "Signal lost"
          : "Searching";
  const clock = broadcastClock(status?.clock ?? null);
  return (
    <section className="rds-panel" aria-label="RDS/RBDS reception">
      <div className="rds-heading">
        <h2>RDS / RBDS</h2>
        <span
          className={`chip ${receiving ? "armer-lock" : ""}`}
          data-testid="rds-state"
        >
          {state}
        </span>
      </div>
      {enabled ? (
        <>
          {test && (
            <p className="armer-test-note">
              Generated FM/RDS test signal · Synthetic station data, not
              received broadcast information.
            </p>
          )}
          <dl className="rds-identity">
            <div>
              <dt>Station name · PS</dt>
              <dd data-testid="rds-ps">
                {status?.ps || "Awaiting complete name"}
              </dd>
            </div>
            <div>
              <dt>PI code</dt>
              <dd data-testid="rds-pi">
                {status?.pi !== null && status?.pi !== undefined
                  ? status.pi.toString(16).toUpperCase().padStart(4, "0")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Program type</dt>
              <dd data-testid="rds-pty">
                {ptyLabel(status?.pty ?? null, region)}
              </dd>
            </div>
          </dl>
          <div className="rds-text">
            <span className="field-label">RadioText</span>
            <p data-testid="rds-text">
              {status?.radioText ||
                (receiving
                  ? "Waiting for complete RadioText…"
                  : "Waiting for CRC-valid RDS groups…")}
            </p>
          </div>
          <div className="rds-footer">
            <label>
              PTY labels{" "}
              <select
                aria-label="RDS program type region"
                value={region}
                onChange={(e) => {
                  const value = e.target.value as RdsRegion;
                  setRegion(value);
                  try {
                    localStorage.setItem("spectrum-rds-region", value);
                  } catch {
                    /* Optional preference. */
                  }
                }}
              >
                <option value="rbds">RBDS · North America</option>
                <option value="rds">RDS · International</option>
              </select>
            </label>
            <span data-testid="rds-valid">
              {status?.validGroups ?? 0} CRC-valid groups
            </span>
            {status?.secondsSinceGroup !== null &&
              status?.secondsSinceGroup !== undefined &&
              active && (
                <span>
                  Last valid {status.secondsSinceGroup.toFixed(1)} s ago
                </span>
              )}
          </div>
          <details className="rds-details">
            <summary>Broadcast details</summary>
            <table>
              <tbody>
                <tr>
                  <th>Traffic program · TP</th>
                  <td>
                    {status?.tp === null || status?.tp === undefined
                      ? "—"
                      : status.tp
                        ? "Yes"
                        : "No"}
                  </td>
                </tr>
                <tr>
                  <th>Traffic announcement · TA</th>
                  <td>
                    {status?.ta === null || status?.ta === undefined
                      ? "—"
                      : status.ta
                        ? "Active"
                        : "Inactive"}
                  </td>
                </tr>
                <tr>
                  <th>Music / speech flag</th>
                  <td>
                    {status?.music === null || status?.music === undefined
                      ? "—"
                      : status.music
                        ? "Music"
                        : "Speech"}
                  </td>
                </tr>
                {clock && (
                  <tr>
                    <th>Broadcast clock</th>
                    <td data-testid="rds-clock">{clock}</td>
                  </tr>
                )}
                <tr>
                  <th>Group types</th>
                  <td>
                    {status?.groupTypes
                      .map((count, kind) =>
                        count
                          ? `${Math.floor(kind / 2)}${kind % 2 ? "B" : "A"}: ${count}`
                          : null,
                      )
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
                <tr>
                  <th>Last validated group</th>
                  <td className="mono-text">
                    {status?.lastGroup
                      ?.map((word) =>
                        word.toString(16).toUpperCase().padStart(4, "0"),
                      )
                      .join(" ") || "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </details>
          <p className="caption">
            Only complete CRC-valid groups update station data. Two groups with
            the same PI confirm reception; a 57 kHz peak alone does not.{" "}
            {(!active || !receiving) &&
            status?.pi !== null &&
            status?.pi !== undefined
              ? "Displayed fields are last decoded information."
              : ""}
          </p>
        </>
      ) : (
        <p className="caption">
          Enable Decode RDS/RBDS in the WFM panel to read station information.
        </p>
      )}
    </section>
  );
}
