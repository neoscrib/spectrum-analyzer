import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadWasm } from "./wasm-receivers.mjs";
const expected = {
  dsp_core: ["Channelizer", "IqChannelizer"],
  am: ["AmDecoder"],
  wfm: ["WfmDecoder"],
  wwv: ["WwvDecoder"],
  nfm: ["NfmDecoder"],
  ook: ["OokDecoder"],
  armer: ["ArmerTestSource", "Receiver"],
  same: ["SameDecoder"],
};
const sizes = {};
for (const [name, exports] of Object.entries(expected)) {
  const native = await loadWasm(name);
  assert.deepEqual(
    Object.keys(native)
      .filter((key) => key !== "default" && key !== "initSync")
      .sort(),
    exports,
  );
  const bytes = await readFile(
    new URL(`../src/wasm/${name}_bg.wasm`, import.meta.url),
  );
  sizes[name] = bytes.length;
}
console.log("Independent WASM exports / bytes:", sizes);
