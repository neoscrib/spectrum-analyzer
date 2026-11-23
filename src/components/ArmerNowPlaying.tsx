import { useMemo } from "react";
import { resolver, type ArmerConfig, type ArmerStatus } from "../armer/model";
import { callLabels, callState } from "../armer/now-playing";

export function ArmerNowPlaying({
  status,
  config,
  control,
  active,
  playing,
  fresh,
}: {
  status: ArmerStatus | null;
  config: ArmerConfig;
  control: number;
  active: boolean;
  playing: boolean;
  fresh: boolean;
}) {
  const receiving = active && fresh && status !== null;
  const resolve = useMemo(() => resolver(config), [config]);
  const calls = receiving
    ? [...(status.calls ?? [])]
        .filter((c) => c.age < 4)
        .sort(
          (a, b) =>
            Number(b.selected) - Number(a.selected) ||
            a.frequency - b.frequency ||
            a.channel - b.channel,
        )
    : [];
  const controlActive = receiving && status.controlLocked;
  return (
    <section
      className="armer-now-playing"
      aria-label="Now Playing"
      data-testid="armer-now"
    >
      <h3>Now Playing</h3>
      <div className="armer-table-scroll">
        <table aria-label="Active ARMER channels">
          <thead>
            <tr>
              <th>Frequency (MHz)</th>
              <th>Talkgroup</th>
              <th>Alias</th>
              <th>Radio ID</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {controlActive && (
              <tr className="armer-control-row" data-testid="armer-control-row">
                <td>{(control / 1e6).toFixed(6)}</td>
                <td>—</td>
                <td className="armer-now-alias">
                  {config.siteName || "Control channel"}
                </td>
                <td>—</td>
                <td>
                  <span className="armer-call-state" data-state="control">
                    Control
                  </span>
                </td>
              </tr>
            )}
            {calls.map((call) => {
              const rule = resolve(call.talkgroup),
                state = callState(
                  call,
                  status!.audioTalkgroup,
                  playing,
                  rule?.listen ?? config.defaultListen,
                );
              return (
                <tr
                  key={`${call.channel}:${call.talkgroup}`}
                  data-talkgroup={call.talkgroup}
                  data-channel={call.channel}
                >
                  <td
                    title={`Channel ${call.channel >> 12}-${call.channel & 0xfff}`}
                  >
                    {call.frequency
                      ? (call.frequency / 1e6).toFixed(6)
                      : "Unresolved"}
                  </td>
                  <td>{call.talkgroup}</td>
                  <td className="armer-now-alias">
                    {rule?.name || "Unlisted talkgroup"}
                  </td>
                  <td>{call.source || "—"}</td>
                  <td>
                    <span className="armer-call-state" data-state={state}>
                      {callLabels[state]}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!controlActive && !calls.length && (
              <tr>
                <td colSpan={5} className="armer-now-empty">
                  {!active
                    ? "Receiver stopped."
                    : fresh
                      ? "Waiting for active calls or control-channel data…"
                      : "Waiting for receiver data…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="caption">
        One call plays at a time. Other rows show current voice-channel
        assignments.
      </p>
    </section>
  );
}
