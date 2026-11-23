import type { ControlChannel, SystemInformation } from "../armer/model";

export const hexDecimal = (value: number | undefined | null, width: number) =>
  value == null
    ? "—"
    : `${value.toString(16).toUpperCase().padStart(width, "0")} [${value}]`;
const frequency = (hz: number | null) =>
  hz === null ? "Unresolved" : (hz / 1e6).toFixed(6);
const channelName = (id: number) => `${id >> 12}-${id & 0xfff}`;
const flags = (value: number) =>
  [
    value & 8 && "Conventional",
    value & 4 && "Failure condition",
    value & 2 && "Valid information",
    value & 1 && "Active RFSS connection",
  ]
    .filter(Boolean)
    .join(" · ") || "No status flags";
function Channels({
  primary,
  secondary,
}: Pick<SystemInformation, "primary" | "secondary">) {
  const row = (name: string, c: ControlChannel) => (
    <tr key={`${name}:${c.id}`}>
      <td>{name}</td>
      <td>{channelName(c.id)}</td>
      <td title={c.downlink === null ? undefined : `${c.downlink} Hz`}>
        {frequency(c.downlink)}
      </td>
      <td title={c.uplink === null ? undefined : `${c.uplink} Hz`}>
        {frequency(c.uplink)}
      </td>
    </tr>
  );
  return (
    <div className="armer-table-scroll">
      <table aria-label="Site control channels">
        <thead>
          <tr>
            <th>Role</th>
            <th>Channel</th>
            <th>Downlink (MHz)</th>
            <th>Uplink (MHz)</th>
          </tr>
        </thead>
        <tbody>
          {primary && row("Primary", primary)}
          {secondary.map((c) => row("Secondary", c))}
        </tbody>
      </table>
    </div>
  );
}
export function ArmerSystemSummary({
  information: i,
}: {
  information?: SystemInformation;
}) {
  const n = i?.network,
    s = i?.site,
    station = i?.station;
  return (
    <div className="armer-system-summary" data-testid="armer-system-summary">
      <h4>Network</h4>
      <dl>
        <div>
          <dt>WACN</dt>
          <dd>{hexDecimal(n?.wacn, 5)}</dd>
        </div>
        <div>
          <dt>System</dt>
          <dd>{hexDecimal(n?.system, 3)}</dd>
        </div>
        <div>
          <dt>NAC</dt>
          <dd>{hexDecimal(n?.nac, 3)}</dd>
        </div>
        <div>
          <dt>LRA</dt>
          <dd>{hexDecimal(n?.lra, 2)}</dd>
        </div>
      </dl>
      <h4>Current site</h4>
      <dl>
        <div>
          <dt>System</dt>
          <dd>{hexDecimal(s?.system, 3)}</dd>
        </div>
        <div>
          <dt>NAC</dt>
          <dd>{hexDecimal(s?.nac, 3)}</dd>
        </div>
        <div>
          <dt>RFSS</dt>
          <dd>{hexDecimal(s?.rfss, 2)}</dd>
        </div>
        <div>
          <dt>Site</dt>
          <dd>{hexDecimal(s?.site, 2)}</dd>
        </div>
        <div>
          <dt>LRA</dt>
          <dd>{hexDecimal(s?.lra, 2)}</dd>
        </div>
      </dl>
      <p className="armer-site-status">
        {s
          ? s.flags & 1
            ? "Active RFSS network connection"
            : "No active RFSS network connection advertised"
          : "Waiting for site status"}
      </p>
      {i?.primary ? (
        <Channels primary={i.primary} secondary={i.secondary} />
      ) : (
        <p className="caption">
          Waiting for a primary control-channel announcement.
        </p>
      )}
      <div className="armer-station-license">
        <span>Station ID / license</span>
        <strong data-testid="armer-callsign">
          {!station
            ? "Waiting for station ID"
            : !station.valid
              ? "Invalid callsign encoding"
              : station.callsign || "No callsign in latest ID"}
        </strong>
        {station && (
          <small data-testid="armer-identification-channel">
            {station.control.downlink === null
              ? "Frequency unresolved"
              : `${(station.control.downlink / 1e6).toFixed(5)} MHz`}{" "}
            · {channelName(station.control.id)} · 0x
            {station.control.id.toString(16).toUpperCase().padStart(4, "0")}
          </small>
        )}
      </div>
      <h4>
        Neighbor sites <small>{i?.neighbors.length ?? 0} learned</small>
      </h4>
      {i?.neighbors.length ? (
        <>
          <div className="armer-table-scroll">
            <table aria-label="Neighbor sites">
              <thead>
                <tr>
                  <th>System</th>
                  <th>Rx NAC</th>
                  <th>RFSS / Site</th>
                  <th>LRA</th>
                  <th>Channel</th>
                  <th>Downlink (MHz)</th>
                  <th>Uplink (MHz)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {i.neighbors.map((site) => (
                  <tr key={`${site.system}:${site.rfss}:${site.site}`}>
                    <td>{hexDecimal(site.system, 3)}</td>
                    <td>{hexDecimal(site.nac, 3)}</td>
                    <td>
                      {hexDecimal(site.rfss, 2)} / {hexDecimal(site.site, 2)}
                    </td>
                    <td>{hexDecimal(site.lra, 2)}</td>
                    <td>{channelName(site.control.id)}</td>
                    <td>{frequency(site.control.downlink)}</td>
                    <td>{frequency(site.control.uplink)}</td>
                    <td className="armer-table-text">{flags(site.flags)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption">
            Rx NAC belongs to the control channel carrying the neighbor
            announcement.
          </p>
        </>
      ) : (
        <p className="caption">No neighbor announcements received.</p>
      )}
      <h4>Frequency bands</h4>
      {i?.bands.length ? (
        <div className="armer-table-scroll">
          <table aria-label="Frequency bands">
            <thead>
              <tr>
                <th>Band</th>
                <th>Mode</th>
                <th>Base (MHz)</th>
                <th>Width (kHz)</th>
                <th>Spacing (kHz)</th>
                <th>TX offset (MHz)</th>
                <th>Slots</th>
              </tr>
            </thead>
            <tbody>
              {i.bands.map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>{b.slots > 1 ? "TDMA" : "FDMA"}</td>
                  <td>{(b.base / 1e6).toFixed(6)}</td>
                  <td>{b.bandwidth / 1000}</td>
                  <td>{b.spacing / 1000}</td>
                  <td>{b.offset / 1e6}</td>
                  <td>{b.slots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="caption">Waiting for broadcast band plans.</p>
      )}
      <h4>Active patch groups</h4>
      {i?.patches.length ? (
        <div className="armer-table-scroll">
          <table aria-label="Active patch groups">
            <thead>
              <tr>
                <th>Patch group</th>
                <th>Members</th>
                <th>Expires in</th>
              </tr>
            </thead>
            <tbody>
              {i.patches.map((p) => (
                <tr key={p.group}>
                  <td>{p.group}</td>
                  <td className="armer-table-text">{p.members.join(", ")}</td>
                  <td>{p.expiresIn.toFixed(1)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="caption">None observed.</p>
      )}
      <h4>System radio aliases</h4>
      <p className="caption">
        Over-the-air talker aliases are not decoded yet.
      </p>
    </div>
  );
}
