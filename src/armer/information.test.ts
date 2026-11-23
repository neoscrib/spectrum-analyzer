import { describe, expect, it } from "vitest";
import { emptyInformation, updateInformation } from "./information";
import type { P25Event } from "./model";

function broadcast(
  opcode: number,
  message: string,
  time = 1,
  mfid = 0,
): P25Event {
  return {
    kind: "control",
    frequency: 853075000,
    talkgroup: 0,
    source: 0,
    channel: 0,
    encrypted: null,
    message,
    nac: 0x40c,
    system: 0,
    wacn: 0,
    rfss: 0,
    site: 0,
    members: [],
    corrections: 0,
    time,
    control: { opcode, mfid, text: message },
  };
}
describe("ARMER control-channel information", () => {
  it("folds repeated broadcasts without letting voice grants crowd them out", () => {
    const network = broadcast(0x3b, "network"),
      site = broadcast(0x3a, "site");
    const first = updateInformation(emptyInformation(), [network, site]);
    const next = updateInformation(first, [
      broadcast(0, "voice grant"),
      broadcast(0x3b, "network", 7),
    ]);
    expect(next.announcements).toHaveLength(2);
    expect(next.announcements[0]).toMatchObject({
      count: 2,
      event: { time: 7, message: "network" },
    });
    expect(first.announcements[0].event).toBe(site);
    expect(first.announcements[1].count).toBe(1);
  });
  it("bounds broadcast history independently of the native system summary", () => {
    const bsi = broadcast(0x0b, "BSI", 1, 0x90);
    bsi.control!.station = {
      callsign: "",
      valid: true,
      channel: 331,
      frequency: 853075000,
    };
    const state = updateInformation(emptyInformation(), [
      bsi,
      ...Array.from({ length: 100 }, (_, i) =>
        broadcast(0x3c, `neighbor ${i}`, i + 2),
      ),
    ]);
    expect(state.announcements).toHaveLength(24);
    expect(state.announcements[0].event.message).toBe("neighbor 99");
    expect(
      updateInformation(state, [broadcast(0x3b, "other vendor", 200, 0xa4)]),
    ).toEqual(state);
  });
});
