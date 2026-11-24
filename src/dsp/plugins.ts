import type { MeteorBiasCommand } from "../meteor/bias";
import type { DecoderInput } from "../meteor/model";
import type { Settings } from "../model";
import type { DecoderEvent } from "../types";
import type { ArmerPolicy } from "../armer/model";
import type { NfmMonitorConfig } from "../presets/model";

/** A worker-owned instance, recreated on configuration/revision changes.
 * CU8 inputs remain worker-owned. Output buffers transfer ownership to consumers.
 * Metadata never aliases WASM memory. dispose() releases all native state. */
export interface DecoderPlugin {
  process(iq: Uint8Array, firstSample: number): DecoderEvent[];
  dispose(): void;
  setMeteorBias?(command: MeteorBiasCommand): void;
  setPolicy?(policy: ArmerPolicy): void;
  setHold?(id: string | null): void;
  recenter?(settings: Settings): void;
  setMultiplexEnabled?(enabled: boolean): void;
  setStereoEnabled?(enabled: boolean): void;
  setRdsEnabled?(enabled: boolean): void;
}
/** These imports are intentionally dynamic: metadata/UI must never pull in a
 * native decoder, its glue, or its protocol dependencies. */
export async function createDecoder(
  s: Settings,
  policy: ArmerPolicy,
  monitor: NfmMonitorConfig | null,
  input?: DecoderInput,
): Promise<DecoderPlugin | undefined> {
  switch (s.decoder) {
    case "none":
      return undefined;
    case "wfm":
      return (await import("./wfm-plugin")).wfmPlugin(s);
    case "am":
      return (await import("./am-plugin")).amPlugin(s);
    case "wwv":
      return (await import("./wwv-plugin")).wwvPlugin(s);
    case "nfm":
      return (await import("./nfm-plugin")).nfmPlugin(s, monitor);
    case "ook":
      return (await import("./ook-plugin")).ookPlugin(s);
    case "armer":
      return (await import("./armer-plugin")).armerPlugin(s, policy);
    case "meteor":
      return (await import("./meteor-plugin")).meteorPlugin(s, input);
    case "rtl433":
      return (await import("./rtl433-plugin")).rtl433Plugin(s);
  }
}
