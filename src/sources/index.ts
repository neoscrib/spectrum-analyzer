import { openRtl } from "./rtl";
import { openHackrf } from "./hackrf";
import { openBridge } from "./soapy";
import { defaultSource, type SourceOptions, type RadioSource } from "./model";
/** No await before the USB chooser: retain the original user gesture. */
export function openSource(
  options: SourceOptions = defaultSource,
): Promise<RadioSource> {
  switch (options.kind) {
    case "rtl":
      return openRtl();
    case "hackrf":
      return openHackrf();
    case "soapy":
      return openBridge(options);
  }
}
