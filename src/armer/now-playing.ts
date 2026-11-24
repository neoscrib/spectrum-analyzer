import type { ActiveCall, ArmerAudioStream } from "./model";
import { audibleTalkgroup, DEFAULT_ARMER_MIX, type ArmerMix } from "./audio";

export type CallState =
  | "playing"
  | "paused"
  | "receiving"
  | "active"
  | "muted"
  | "encrypted"
  | "outside"
  | "unresolved"
  | "unsupported"
  | "unknown";
export const callLabels: Record<CallState, string> = {
  playing: "Playing",
  paused: "Audio paused",
  receiving: "Receiving",
  active: "Waiting for voice slot",
  muted: "Muted",
  encrypted: "Encrypted",
  outside: "Outside capture",
  unresolved: "Band plan pending",
  unsupported: "Phase II · unsupported",
  unknown: "Encryption unknown",
};
export function callState(
  call: ActiveCall,
  audioStreams: readonly ArmerAudioStream[] | number,
  playing: boolean,
  listening: boolean,
  mix: ArmerMix = DEFAULT_ARMER_MIX,
): CallState {
  if (call.encrypted === true) return "encrypted";
  if (!listening || !audibleTalkgroup(call.talkgroup, mix)) return "muted";
  if (!call.frequency) return "unresolved";
  if (call.phase2) return "unsupported";
  if (!call.inCapture) return "outside";
  if (call.encrypted === null) return "unknown";
  const hasAudio =
    typeof audioStreams === "number"
      ? call.talkgroup === audioStreams
      : audioStreams.some(
          (s) =>
            s.talkgroup === call.talkgroup &&
            s.frequency === call.frequency &&
            (call.streamId == null || call.streamId === s.id),
        );
  if (call.selected && hasAudio) return playing ? "playing" : "paused";
  return call.selected ? "receiving" : "active";
}
