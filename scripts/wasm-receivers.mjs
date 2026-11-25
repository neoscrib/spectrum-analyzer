// Node-only harness for the same block-level shared-DSP composition as the app.
import { readFile } from "node:fs/promises";
const modules = new Map();
export function loadWasm(name) {
  if (!modules.has(name))
    modules.set(
      name,
      (async () => {
        const native = await import(`../src/wasm/${name}.js`);
        await native.default({
          module_or_path: await readFile(
            new URL(`../src/wasm/${name}_bg.wasm`, import.meta.url),
          ),
        });
        return native;
      })(),
    );
  return modules.get(name);
}
export async function receiverModule(name) {
  const native = await loadWasm(name);
  const className = {
    am: "AmDecoder",
    wfm: "WfmDecoder",
    wwv: "WwvDecoder",
    ook: "OokDecoder",
  }[name];
  if (!className) return native;
  const core = await loadWasm("dsp_core");
  return {
    ...native,
    [className]: class extends native[className] {
      constructor(...args) {
        super(...args);
        const [offset, bandwidth] = args;
        this.front =
          name === "wfm"
            ? core.Channelizer.wfm(offset, bandwidth)
            : new core.Channelizer(
                offset,
                90000,
                name === "ook" ? 161 : 121,
                10,
              );
      }
      process(iq) {
        return super.process_baseband(this.front.process(iq));
      }
      free() {
        this.front.free();
        super.free();
      }
    },
  };
}
