import { describe, expect, it } from "vitest";
import { callState } from "./now-playing";
import type { ActiveCall } from "./model";
import { DEFAULT_ARMER_MIX } from "./audio";
const call: ActiveCall = {
  channel: 279,
  talkgroup: 6620,
  source: 42,
  frequency: 852750000,
  encrypted: false,
  selected: true,
  inCapture: true,
  phase2: false,
  age: 0,
};
describe("Now Playing status", () => {
  it("reports multiple playing streams and applies live per-talkgroup mix controls", () => {
    const streams = [
      { id: 1, talkgroup: 6620, frequency: 852750000 },
      { id: 2, talkgroup: 6640, frequency: 852800000 },
    ];
    const other = {
      ...call,
      talkgroup: 6640,
      frequency: 852800000,
      streamId: 2,
    };
    expect(callState({ ...call, streamId: 1 }, streams, true, true)).toBe(
      "playing",
    );
    expect(callState(other, streams, true, true)).toBe("playing");
    expect(
      callState(other, streams, true, true, {
        ...DEFAULT_ARMER_MIX,
        solo: 6620,
      }),
    ).toBe("muted");
    expect(
      callState(other, streams, true, true, {
        ...DEFAULT_ARMER_MIX,
        muted: [6640],
      }),
    ).toBe("muted");
    expect(
      callState(other, streams, true, true, {
        ...DEFAULT_ARMER_MIX,
        gains: { 6640: 0 },
      }),
    ).toBe("muted");
    expect(callState({ ...other, streamId: 3 }, streams, true, true)).toBe(
      "receiving",
    );
  });
  it("requires the selected audio stream and enabled playback before claiming Playing", () => {
    expect(callState(call, 6620, true, true)).toBe("playing");
    expect(callState(call, 6620, false, true)).toBe("paused");
    expect(callState(call, 6640, true, true)).toBe("receiving");
    expect(callState({ ...call, selected: false }, 6620, true, true)).toBe(
      "active",
    );
  });
  it("keeps restricted or unavailable assignments visible without claiming audio", () => {
    expect(callState(call, 6620, true, false)).toBe("muted");
    expect(callState({ ...call, encrypted: true }, 6620, true, true)).toBe(
      "encrypted",
    );
    expect(callState({ ...call, encrypted: null }, 6620, true, true)).toBe(
      "unknown",
    );
    expect(callState({ ...call, inCapture: false }, 6620, true, true)).toBe(
      "outside",
    );
    expect(callState({ ...call, phase2: true }, 6620, true, true)).toBe(
      "unsupported",
    );
    expect(callState({ ...call, frequency: 0 }, 6620, true, true)).toBe(
      "unresolved",
    );
  });
});
