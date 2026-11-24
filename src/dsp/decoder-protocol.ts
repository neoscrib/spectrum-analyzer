import type { MeteorBiasCommand } from "../meteor/bias";
import type { DecoderInput } from "../meteor/model";
import type { Settings } from "../model";
import type { ArmerPolicy } from "../armer/model";
import type { NfmMonitorConfig } from "../presets/model";
import type { DecoderEvent } from "../types";

export type DecoderRequest =
  | { type: "meteor-bias"; command: MeteorBiasCommand }
  | {
      type: "configure";
      settings: Settings;
      policy: ArmerPolicy;
      monitor: NfmMonitorConfig | null;
      multiplex: boolean;
      input?: DecoderInput;
    }
  | { type: "process"; data: ArrayBuffer; firstSample: number }
  | { type: "test"; firstSample: number }
  | { type: "recenter"; settings: Settings }
  | { type: "wfm-multiplex"; enabled: boolean }
  | { type: "wfm-stereo"; enabled: boolean }
  | { type: "wfm-rds"; enabled: boolean }
  | { type: "armer-policy"; policy: ArmerPolicy }
  | { type: "nfm-hold"; holdId: string | null };
export type DecodedBlock = { data: ArrayBuffer; events: DecoderEvent[] };
export type DecoderReply = { id: number } & (
  { type: "done"; block?: DecodedBlock } | { type: "error"; message: string }
);
