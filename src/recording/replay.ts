import type { Settings } from "../model";
import type { IqSource } from "../meteor/iq";
export interface IqReplayRequest {
  file: File;
  source: IqSource;
  settings: Settings;
}
/** Shared bounded CU8/SigMF import for fixed-rate decoders. Multi-capture
 * retunes must be implemented explicitly, never silently treated as one band. */
export async function inspectCu8Replay(
  file: File,
  metaFile: File | undefined,
  settings: Settings,
  referenceTime?: string,
): Promise<IqReplayRequest> {
  if (!file.size || file.size % 2)
    throw Error("CU8 recordings must contain complete I/Q pairs.");
  let center = settings.center;
  if (metaFile) {
    if (metaFile.size > 1024 * 1024)
      throw Error("SigMF metadata is too large.");
    const meta: unknown = JSON.parse(await metaFile.text());
    if (!meta || typeof meta !== "object")
      throw Error("Invalid SigMF metadata.");
    const global =
      "global" in meta && meta.global && typeof meta.global === "object"
        ? (meta.global as Record<string, unknown>)
        : {};
    if (
      global["core:datatype"] !== "cu8" ||
      global["core:sample_rate"] !== 2400000
    )
      throw Error("This decoder requires CU8 recordings at 2.4 MSPS.");
    const captures =
      "captures" in meta && Array.isArray(meta.captures)
        ? (meta.captures as unknown[])
        : [];
    if (captures.length > 1)
      throw Error("Replay supports one fixed-frequency SigMF capture.");
    const c = captures[0];
    if (c && typeof c === "object") {
      const capture = c as Record<string, unknown>;
      if (
        capture["core:sample_start"] !== undefined &&
        capture["core:sample_start"] !== 0
      )
        throw Error("SigMF capture must start at sample zero.");
      if (capture["core:frequency"] !== undefined) {
        if (
          typeof capture["core:frequency"] !== "number" ||
          !Number.isFinite(capture["core:frequency"])
        )
          throw Error("Invalid SigMF center frequency.");
        center = capture["core:frequency"];
      }
      if (capture["core:datetime"] !== undefined) {
        if (typeof capture["core:datetime"] !== "string")
          throw Error("Invalid SigMF capture datetime.");
        referenceTime = new Date(capture["core:datetime"]).toISOString();
      }
    }
  }
  return {
    file,
    source: {
      format: "cu8",
      sampleRate: 2400000,
      offset: 0,
      length: file.size,
      center,
      referenceTime,
    },
    settings: { ...settings, center },
  };
}
