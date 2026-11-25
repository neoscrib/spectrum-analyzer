import type { MeteorOptions } from "./model";
import { parseTle, tleAgeDays } from "./tracking";

/** Live preferences only. Historical capture/replay booleans are authoritative. */
export function defaultLiveDoppler(
  options: MeteorOptions,
  now = Date.now(),
): MeteorOptions {
  const preference = options.dopplerPreference ?? "auto";
  if (preference !== "auto")
    return {
      ...options,
      dopplerPreference: preference,
      doppler: preference === "on",
    };
  let available = false;
  try {
    const orbit = parseTle(options.tle, options.satellite);
    available = Math.abs(tleAgeDays(orbit, now)) <= 14;
  } catch {
    /* Incomplete, mismatched or invalid TLEs never enable correction. */
  }
  return { ...options, dopplerPreference: "auto", doppler: available };
}
