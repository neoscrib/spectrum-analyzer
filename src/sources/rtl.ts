import { RTL2832U_Provider } from "@jtarrio/webrtlsdr/rtlsdr.js";
import rtlUsbIds from "./rtl-usb-ids.json";
import { sourceDefaults, validateReceiver, type RadioSource } from "./model";
/** Keep the library's driver and transfer behavior. Device selection still runs
 * synchronously inside the click gesture. Other hardware uses its own driver. */
export async function openRtl(): Promise<RadioSource> {
  let selected: USBDevice | undefined;
  const webusb = new Proxy(navigator.usb, {
    get(target, property) {
      if (property === "requestDevice")
        return async (options: USBDeviceRequestOptions) => {
          // Known RTL2832U IDs from osmocom/rtl-sdr's device table. The existing
          // driver still verifies the tuner; other tuners can use SoapySDR.
          selected = await target.requestDevice({
            ...options,
            filters: rtlUsbIds.map(([vendorId, productId]) => ({
              vendorId,
              productId,
            })),
          });
          return selected;
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const device = await new RTL2832U_Provider({ webusb })
    .get()
    .catch(async (error) => {
      if (selected?.opened) await selected.close().catch(() => {});
      if (/unsupported tuner/i.test(String(error)))
        throw Error(
          "This RTL-SDR tuner is not supported by the WebUSB driver. Use the SoapySDR bridge with the RTL-SDR module.",
        );
      throw error;
    });
  let previous:
    { center: number; gain: number | null; ppm: number } | undefined;
  const info = sourceDefaults("rtl");
  if (
    selected?.manufacturerName === "RTLSDRBlog" &&
    selected.productName === "Blog V4"
  ) {
    info.name = "RTL-SDR Blog V4";
    info.minHz = 500000;
  }
  return {
    info,
    async configure(s) {
      validateReceiver(s, info);
      if (!previous) {
        const rate = await device.setSampleRate(info.sampleRate);
        if (rate !== info.sampleRate)
          throw Error(
            `RTL-SDR returned ${rate} samples/s; 2.4 MSPS is required.`,
          );
      }
      if (s.ppm !== previous?.ppm) await device.setFrequencyCorrection(s.ppm);
      if (s.center !== previous?.center || s.ppm !== previous?.ppm)
        await device.setCenterFrequency(s.center);
      if (!previous || s.gain !== previous.gain) await device.setGain(s.gain);
      if (!previous) await device.enableBiasTee(false);
      await device.resetBuffer();
      previous = { ...s };
    },
    readSamples: (count) => device.readSamples(count),
    close: () => device.close(),
  };
}
