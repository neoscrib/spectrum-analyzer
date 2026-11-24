import type { ReplayOptions, Settings } from "./types.ts";
import { parseTle, tleAgeDays, dopplerHz } from "./tracking.ts";

/** Recorded sample time, independent of replay speed and today's wall clock. */
export function createReplayTuning(settings: Settings, options: ReplayOptions) {
  let sat: ReturnType<typeof parseTle> | undefined;
  let captureStart = NaN;
  if (options.historicalDoppler) {
    const start = options.recordingStartUtc;
    if (
      typeof start !== "string" ||
      !/(Z|[+-]\d\d:\d\d)$/.test(start) ||
      !Number.isFinite(Date.parse(start))
    )
      throw Error(
        "Recorded Doppler requires the original capture start with an explicit UTC offset. Import its capture metadata.",
      );
    captureStart = Date.parse(start);
    sat = parseTle(settings.tle, settings.satellite);
    if (Math.abs(tleAgeDays(sat, captureStart)) > 14)
      throw Error(
        "The recorded TLE is more than 14 days from the capture time. Import matching orbital elements.",
      );
  }
  return (processedSamples: number) => {
    const seconds =
      Math.floor(options.startSeconds * settings.sampleRate) /
        settings.sampleRate +
      processedSamples / settings.sampleRate;
    const time = captureStart + seconds * 1000;
    // Orbit math differs by nanohertz between JS engines. Quantize far below
    // orbital/oscillator uncertainty so offline and browser DSP get identical
    // NCO commands; tiny roundoff can otherwise change marginal acquisitions.
    const shift = sat
      ? Math.round(dopplerHz(sat, settings, time, settings.frequency) * 100) /
        100
      : 0;
    return {
      offsetHz:
        settings.frequency -
        settings.center +
        options.frequencyOffsetHz +
        shift,
      dopplerHz: shift,
      captureTimeUtc: sat ? new Date(time).toISOString() : undefined,
    };
  };
}
