import type { ActiveCall } from "./model";

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
  active: "Active",
  muted: "Muted",
  encrypted: "Encrypted",
  outside: "Outside capture",
  unresolved: "Band plan pending",
  unsupported: "Phase II · unsupported",
  unknown: "Encryption unknown",
};
export function callState(
  call: ActiveCall,
  audioTalkgroup: number,
  playing: boolean,
  listening: boolean,
): CallState {
  if (call.encrypted === true) return "encrypted";
  if (!listening) return "muted";
  if (!call.frequency) return "unresolved";
  if (call.phase2) return "unsupported";
  if (!call.inCapture) return "outside";
  if (call.encrypted === null) return "unknown";
  if (call.selected && call.talkgroup === audioTalkgroup)
    return playing ? "playing" : "paused";
  return call.selected ? "receiving" : "active";
}
