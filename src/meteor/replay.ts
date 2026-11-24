import type { IqSource } from "./iq";
import type { ReplayOptions, Settings } from "./types";
import { validateSettings } from "./settings";
import { createReplayTuning } from "./replay-tuning";

export const DEFAULT_REPLAY: ReplayOptions = {
  startSeconds: 0,
  durationSeconds: null,
  frequencyOffsetHz: 0,
  autoBias: true,
};
export function validateReplay(
  options: ReplayOptions,
  settings: Settings,
): string | undefined {
  if (
    options.estimateBias !== undefined &&
    typeof options.estimateBias !== "boolean"
  )
    return "Choose whether to estimate replay frequency bias.";
  if (options.autoBias !== undefined && typeof options.autoBias !== "boolean")
    return "Choose whether replay bias correction is automatic.";
  if (!Number.isFinite(options.startSeconds) || options.startSeconds < 0)
    return "Replay start must be zero or more seconds.";
  if (
    options.durationSeconds !== null &&
    (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0)
  )
    return "Replay length must be positive, or blank for the rest of the file.";
  if (
    !Number.isFinite(options.frequencyOffsetHz) ||
    Math.abs(options.frequencyOffsetHz) > 100000
  )
    return "Replay frequency adjustment must be between −100,000 and +100,000 Hz.";
  if (
    Math.abs(settings.frequency + options.frequencyOffsetHz - settings.center) +
      80000 >
    settings.sampleRate / 2
  )
    return "The adjusted LRPT signal must fit inside the recorded bandwidth.";
  if (
    options.historicalDoppler !== undefined &&
    typeof options.historicalDoppler !== "boolean"
  )
    return "Recorded Doppler must be on or off.";
  if (
    options.reacquireSeconds !== undefined &&
    (!Number.isFinite(options.reacquireSeconds) ||
      options.reacquireSeconds < 0 ||
      options.reacquireSeconds > 60)
  )
    return "Reacquisition delay must be 0–60 seconds (zero disables it).";
  if (
    options.carrierLimitHz !== undefined &&
    (!Number.isFinite(options.carrierLimitHz) ||
      options.carrierLimitHz < 50 ||
      options.carrierLimitHz > 8000)
  )
    return "Residual carrier search must be 50–8,000 Hz, or blank for the default.";
  if (options.historicalDoppler) {
    try {
      createReplayTuning(settings, options);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
}
export function replayRange(source: IqSource, options: ReplayOptions) {
  const stride = source.format === "cu8" ? 2 : source.format === "cs16" ? 4 : 8;
  const first = Math.floor(options.startSeconds * source.sampleRate) * stride;
  if (first >= source.length)
    throw Error("Replay start is beyond the end of this IQ file.");
  const length =
    options.durationSeconds === null
      ? source.length - first
      : Math.min(
          source.length - first,
          Math.floor(options.durationSeconds * source.sampleRate) * stride,
        );
  if (length < stride)
    throw Error("The selected replay range has no complete IQ samples.");
  return { offset: source.offset + first, length, stride };
}
export function importReplayProfile(value: unknown, current: Settings) {
  if (!value || typeof value !== "object")
    throw Error("Unrecognized capture or recovery metadata.");
  const profile = value as Record<string, unknown>;
  if (
    !["meteor-iq-v1", "meteor-replay-v1"].includes(String(profile.schema)) ||
    !profile.settings ||
    typeof profile.settings !== "object"
  )
    throw Error("Unrecognized capture or recovery metadata.");
  const settings = { ...current, ...profile.settings } as Settings;
  const problem = validateSettings(settings);
  if (problem) throw Error(problem);
  if (
    profile.schema === "meteor-replay-v1" &&
    (!profile.replay ||
      typeof profile.replay !== "object" ||
      Array.isArray(profile.replay))
  )
    throw Error(
      "Recovery settings must include a replay range and frequency adjustment.",
    );
  const options: ReplayOptions =
    profile.schema === "meteor-replay-v1"
      ? { ...DEFAULT_REPLAY, ...(profile.replay as object) }
      : { ...DEFAULT_REPLAY };
  if (profile.schema === "meteor-iq-v1" && typeof profile.start === "string") {
    options.recordingStartUtc = profile.start;
    const original = profile.settings as Partial<Settings>;
    options.frequencyOffsetHz = original.frequencyBiasHz ?? 0;
    options.carrierLimitHz = original.carrierLimitHz;
    if (original.doppler && original.tle) {
      options.historicalDoppler = true;
      options.reacquireSeconds = 3;
    }
  }
  if (
    profile.schema === "meteor-replay-v1" &&
    options.historicalDoppler === undefined &&
    profile.historicalDoppler === true
  )
    options.historicalDoppler = true;
  const replayProblem = validateReplay(options, settings);
  if (replayProblem) throw Error(replayProblem);
  const source = profile.source as
    { name?: unknown; bytes?: unknown } | undefined;
  const bytes =
    profile.schema === "meteor-iq-v1" ? profile.bytes : source?.bytes;
  if (
    bytes !== undefined &&
    (!Number.isSafeInteger(bytes) || Number(bytes) <= 0)
  )
    throw Error("Invalid capture byte count.");
  return {
    settings,
    options,
    expectedBytes: bytes === undefined ? undefined : Number(bytes),
  };
}
