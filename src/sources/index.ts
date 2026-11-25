import { openRtl } from "./rtl";
import { openHackrf } from "./hackrf";
import { openBridge } from "./soapy";
import { defaultSource, type SourceOptions, type RadioSource } from "./model";
/** No await before the USB chooser: retain the original user gesture. */
export function openSource(
  options: SourceOptions = defaultSource,
  sampleRate = 2400000,
): Promise<RadioSource> {
  switch (options.kind) {
    case "rtl":
      return openRtl();
    case "hackrf":
      return openHackrf(navigator.usb, sampleRate);
    case "soapy":
      return openBridge(options, sampleRate);
  }
}
