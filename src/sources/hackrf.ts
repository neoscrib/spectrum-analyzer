import { sourceDefaults, validateReceiver, type RadioSource } from "./model";
// USB protocol: Great Scott Gadgets libhackrf. RX only; no transmit, firmware,
// RF amplifier, or antenna-power commands can be enabled by this adapter.
export async function openHackrf(
  usb: USB = navigator.usb,
): Promise<RadioSource> {
  const device = await usb.requestDevice({
    filters: [{ vendorId: 0x1d50, productId: 0x6089 }],
  });
  const out = async (
    request: number,
    value = 0,
    index = 0,
    data?: BufferSource,
  ) => {
    const result = await device.controlTransferOut(
      { requestType: "vendor", recipient: "device", request, value, index },
      data,
    );
    if (
      result.status !== "ok" ||
      (data && result.bytesWritten !== data.byteLength)
    )
      throw Error("HackRF USB control transfer failed.");
  };
  const gain = async (request: number, value: number) => {
    const result = await device.controlTransferIn(
      {
        requestType: "vendor",
        recipient: "device",
        request,
        value: 0,
        index: value,
      },
      1,
    );
    if (
      result.status !== "ok" ||
      result.data?.byteLength !== 1 ||
      result.data.getUint8(0) === 0
    )
      throw Error("HackRF rejected the receive gain.");
  };
  let claimed = false,
    closed = false,
    started = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (claimed) await out(1, 0);
    } finally {
      try {
        if (claimed) await device.releaseInterface(0);
      } finally {
        if (device.opened) await device.close();
      }
    }
  }
  try {
    await device.open();
    if (device.configuration?.configurationValue !== 1)
      await device.selectConfiguration(1);
    await device.claimInterface(0);
    claimed = true;
    await out(1, 0);
    await out(17, 0); // RF amplifier off.
    await out(23, 0); // Antenna power off.
    const info = sourceDefaults("hackrf");
    info.name = device.productName || "HackRF One";
    return {
      info,
      async configure(s) {
        validateReceiver(s, info);
        if (started) await out(1, 0);
        const data = new DataView(new ArrayBuffer(8));
        data.setUint32(0, 2400000, true);
        data.setUint32(4, 1, true);
        await out(6, 0, 0, data.buffer);
        await out(7, 1750000 & 65535, 1750000 >>> 16);
        data.setUint32(0, Math.floor(s.center / 1e6), true);
        data.setUint32(4, Math.round(s.center % 1e6), true);
        await out(16, 0, 0, data.buffer);
        const total = s.gain!,
          lna = Math.min(40, Math.floor(total / 8) * 8);
        await gain(19, lna);
        await gain(20, Math.min(62, Math.round((total - lna) / 2) * 2));
        await out(1, 1);
        started = true;
      },
      async readSamples(count) {
        const result = await device.transferIn(1, count * 2);
        if (
          result.status !== "ok" ||
          !result.data ||
          result.data.byteLength !== count * 2
        )
          throw Error(
            "HackRF USB stream ended or returned a short block; reception stopped to preserve continuity.",
          );
        const bytes = new Uint8Array(
          result.data.buffer,
          result.data.byteOffset,
          result.data.byteLength,
        );
        for (let i = 0; i < bytes.length; i++) bytes[i] ^= 128;
        return {
          data:
            bytes.byteOffset === 0 &&
            bytes.byteLength === bytes.buffer.byteLength
              ? (bytes.buffer as ArrayBuffer)
              : bytes.slice().buffer,
        };
      },
      close,
    };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
