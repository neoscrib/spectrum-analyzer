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
        const cutoff =
          name === "wfm"
            ? Math.max(
                65000,
                Math.min(220000, Math.max(150000, bandwidth)) / 2 - 5000,
              )
            : 90000;
        this.front = new core.Channelizer(
          offset,
          cutoff,
          name === "wfm" ? 401 : name === "ook" ? 161 : 121,
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
