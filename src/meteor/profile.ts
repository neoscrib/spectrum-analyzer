import { validateSettings as validateReference } from "./settings";
import type { Settings } from "../model";
import { referenceSettings } from "./model";
import { importReplayProfile, DEFAULT_REPLAY, validateReplay } from "./replay";
import type { ReplayOptions } from "./types";
import type { MeteorOptions, IqFormat } from "./model";
export interface MeteorReplayProfile {
  settings: Settings;
  options: ReplayOptions;
  sampleRate: number;
  format: IqFormat;
  expectedBytes?: number;
}
export function importMeteorProfile(
  value: unknown,
  current: Settings,
): MeteorReplayProfile {
  if (!value || typeof value !== "object") throw Error("Invalid IQ metadata.");
  const root = value as Record<string, unknown>;
  if (root.schema === "meteor-iq-v1" || root.schema === "meteor-replay-v1") {
    const imported = importReplayProfile(value, referenceSettings(current));
    const r = imported.settings;
    const captured = root.settings as Record<string, unknown>;
    const capturedAutomatic =
      typeof captured.autoBias === "boolean" ? captured.autoBias : true;
    if (root.schema === "meteor-iq-v1")
      imported.options.autoBias = capturedAutomatic;
    const meteor: MeteorOptions = {
      autoBias: capturedAutomatic,
      autoBiasDefaultVersion: 1,
      satellite: r.satellite,
      symbolRate: r.symbolRate,
      mode: r.mode,
      nrzm: r.nrzm,
      interleaved: r.interleaved,
      doppler: r.doppler,
      frequencyBiasHz: r.frequencyBiasHz,
      carrierLimitHz: r.carrierLimitHz,
      latitude: r.latitude,
      longitude: r.longitude,
      altitude: r.altitude,
      minElevation: r.minElevation,
      tle: r.tle,
      reacquireSeconds: r.doppler ? 3 : current.meteor.reacquireSeconds,
    };
    return {
      settings: {
        ...current,
        decoder: "meteor",
        channel: r.frequency,
        center: r.center,
        bandwidth: 180000,
        meteor,
      },
      options: imported.options,
      sampleRate: r.sampleRate,
      format: r.replayFormat,
      expectedBytes: imported.expectedBytes,
    };
  }
  const global = root.global as Record<string, unknown> | undefined;
  const captures = root.captures as Record<string, unknown>[] | undefined;
  if (
    !global ||
    !Array.isArray(captures) ||
    captures.length !== 1 ||
    captures[0]["core:sample_start"] !== 0
  )
    throw Error("Expected Meteor metadata or single-capture SigMF metadata.");
  const rate = global["core:sample_rate"],
    format = global["core:datatype"],
    center = captures[0]["core:frequency"];
  if (
    typeof rate !== "number" ||
    !["cu8", "ci16_le", "cf32_le"].includes(String(format)) ||
    typeof center !== "number" ||
    !Number.isFinite(center)
  )
    throw Error("Unsupported SigMF rate, format or center frequency.");
  const saved = global["spectrum:meteor"];
  if (
    saved !== undefined &&
    (!saved || typeof saved !== "object" || Array.isArray(saved))
  )
    throw Error("Invalid Meteor capture configuration.");
  const meteor = saved as (MeteorOptions & { frequency: number }) | undefined;
  const settings: Settings = {
    ...current,
    decoder: "meteor",
    center,
    bandwidth: 180000,
    ...(meteor
      ? {
          channel: meteor.frequency,
          meteor: {
            ...current.meteor,
            ...meteor,
            autoBias: meteor.autoBias ?? true,
          },
        }
      : {}),
  };
  const options: ReplayOptions = { ...DEFAULT_REPLAY };
  if (meteor) {
    options.autoBias = meteor.autoBias ?? true;
    options.frequencyOffsetHz = meteor.frequencyBiasHz ?? 0;
    options.carrierLimitHz = meteor.carrierLimitHz;
    options.reacquireSeconds = meteor.reacquireSeconds;
    if (meteor.doppler) {
      options.recordingStartUtc = String(captures[0]["core:datetime"] ?? "");
      options.historicalDoppler = true;
    }
  }
  const problem =
    validateReference(
      referenceSettings(settings, { sampleRate: rate, format: "cu8" }),
    ) ||
    validateReplay(
      options,
      referenceSettings(settings, { sampleRate: rate, format: "cu8" }),
    );
  if (problem) throw Error(problem);
  return {
    settings,
    options,
    sampleRate: rate,
    format: format === "cu8" ? "cu8" : format === "ci16_le" ? "cs16" : "cf32",
  };
}
