import { useMemo } from "react";
import { resolver, type ArmerConfig, type ArmerStatus } from "../armer/model";
import { callLabels, callState } from "../armer/now-playing";
import { voiceLimit } from "../armer/model";
import { DEFAULT_ARMER_MIX, type ArmerMix } from "../armer/audio";

export function ArmerNowPlaying({
  status,
  config,
  control,
  active,
  playing,
  fresh,
  mix,
  onMix,
  onVoiceLimit,
}: {
  status: ArmerStatus | null;
  config: ArmerConfig;
  control: number;
  active: boolean;
  playing: boolean;
  fresh: boolean;
  mix: ArmerMix;
  onMix: (mix: ArmerMix) => void;
  onVoiceLimit: (limit: number) => void;
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
      <div className="armer-playback-heading">
        <h3>Now Playing</h3>
        <label className="armer-voice-limit">
          Simultaneous voice channels
          <select
            aria-label="Simultaneous voice channels"
            value={voiceLimit(config)}
            onChange={(e) => onVoiceLimit(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {mix.solo !== null && (
          <button onClick={() => onMix({ ...mix, solo: null })}>
            Clear solo · TG {mix.solo}
          </button>
        )}
        <button onClick={() => onMix(DEFAULT_ARMER_MIX)}>Reset mix</button>
      </div>
      <div className="armer-table-scroll">
        <table aria-label="Active ARMER channels">
          <thead>
            <tr>
              <th>Frequency (MHz)</th>
              <th>Talkgroup</th>
              <th>Alias</th>
              <th>Radio ID</th>
              <th>Status</th>
              <th>Audio</th>
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
                <td>—</td>
              </tr>
            )}
            {calls.map((call) => {
              const rule = resolve(call.talkgroup),
                state = callState(
                  call,
                  status!.audioStreams ?? status!.audioTalkgroup,
                  playing,
                  rule?.listen ?? config.defaultListen,
                  mix,
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
                  <td>
                    <div className="armer-call-audio">
                      <button
                        aria-label={`Mute audio for talkgroup ${call.talkgroup}`}
                        aria-pressed={mix.muted.includes(call.talkgroup)}
                        onClick={() =>
                          onMix({
                            ...mix,
                            muted: mix.muted.includes(call.talkgroup)
                              ? mix.muted.filter((t) => t !== call.talkgroup)
                              : [...mix.muted, call.talkgroup],
                          })
                        }
                      >
                        Mute
                      </button>
                      <button
                        aria-label={`Solo talkgroup ${call.talkgroup}`}
                        aria-pressed={mix.solo === call.talkgroup}
                        onClick={() =>
                          onMix({
                            ...mix,
                            solo:
                              mix.solo === call.talkgroup
                                ? null
                                : call.talkgroup,
                            muted: mix.muted.filter(
                              (t) => t !== call.talkgroup,
                            ),
                          })
                        }
                      >
                        Solo
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(
                          (mix.gains[call.talkgroup] ?? 1) * 100,
                        )}
                        aria-label={`Volume for talkgroup ${call.talkgroup}`}
                        title={`Volume ${Math.round((mix.gains[call.talkgroup] ?? 1) * 100)}%`}
                        onChange={(e) =>
                          onMix({
                            ...mix,
                            gains: {
                              ...mix.gains,
                              [call.talkgroup]: Number(e.target.value) / 100,
                            },
                          })
                        }
                      />
                      <select
                        aria-label={`Pan for talkgroup ${call.talkgroup}`}
                        value={mix.pans[call.talkgroup] ?? 0}
                        onChange={(e) =>
                          onMix({
                            ...mix,
                            pans: {
                              ...mix.pans,
                              [call.talkgroup]: Number(e.target.value),
                            },
                          })
                        }
                      >
                        <option value="-1">Left</option>
                        <option value="0">Center</option>
                        <option value="1">Right</option>
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!controlActive && !calls.length && (
              <tr>
                <td colSpan={6} className="armer-now-empty">
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
        Up to {voiceLimit(config)} clear voice channels play together within the
        capture. Mute, solo, volume and pan affect playback without resetting
        reception.
      </p>
    </section>
  );
}
