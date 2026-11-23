import type { P25Event } from "./model";

export interface ControlAnnouncement {
  key: string;
  event: P25Event;
  count: number;
}
export interface ControlInformation {
  announcements: ControlAnnouncement[];
}
export const emptyInformation = (): ControlInformation => ({
  announcements: [],
});
const broadcastOpcodes = new Set([
  0x29, 0x30, 0x33, 0x34, 0x35, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d,
]);
export function updateInformation(
  previous: ControlInformation,
  events: P25Event[],
): ControlInformation {
  const announcements = [...previous.announcements];
  for (const event of events) {
    const c = event.control;
    if (event.kind !== "control" || !c) continue;
    if (
      !(c.mfid === 0 && broadcastOpcodes.has(c.opcode)) &&
      !(c.mfid === 0x90 && c.opcode === 0x0b)
    )
      continue;
    const key = `${c.mfid}:${c.opcode}:${event.message}`;
    const index = announcements.findIndex((a) => a.key === key);
    const count = index < 0 ? 1 : announcements.splice(index, 1)[0].count + 1;
    announcements.unshift({ key, event, count });
    announcements.length = Math.min(announcements.length, 24);
  }
  return { announcements };
}
