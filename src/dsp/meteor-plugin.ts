import createMeteor from "../wasm-meteor/meteor";
import wasmUrl from "../wasm-meteor/meteor.wasm?url";
import type { Settings } from "../model";
import type { DecoderInput } from "../meteor/model";
import { meteorEngine } from "../meteor/engine";
/** Never cache the instance: fresh linear memory resets upstream static DSP state. */
export async function meteorPlugin(s: Settings, input?: DecoderInput) {
  const native = await createMeteor({ locateFile: () => wasmUrl });
  return meteorEngine(s, native, input);
}
