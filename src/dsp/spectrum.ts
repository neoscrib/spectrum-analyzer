import type { IqFormat } from "../meteor/model";
import { iqStride, iqValue } from "../meteor/input";
import { fft } from "./fft";
/** Hann-windowed, shifted FFT. Values are dBFS per bin, not calibrated dBm. */
export function spectrum(
  iq: Uint8Array,
  size = 2048,
  format: IqFormat = "cu8",
): Float32Array {
  const re = new Float64Array(size),
    im = new Float64Array(size);
  const count = iq.byteLength / iqStride(format),
    offset = Math.max(0, count - size);
  const view = new DataView(iq.buffer, iq.byteOffset, iq.byteLength);
  const value = (n: number) =>
    n < count * 2 ? iqValue(iq, view, n, format) : 0;
  let meanI = 0,
    meanQ = 0;
  for (let i = 0; i < size; i++) {
    meanI += value((offset + i) * 2);
    meanQ += value((offset + i) * 2 + 1);
  }
  meanI /= size;
  meanQ /= size;
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = (value((offset + i) * 2) - meanI) * w;
    im[i] = (value((offset + i) * 2 + 1) - meanQ) * w;
  }
  fft(re, im);
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const p = (i + size / 2) % size;
    out[i] =
      10 * Math.log10((re[p] ** 2 + im[p] ** 2) / (size * 0.5) ** 2 + 1e-12);
  }
  return out;
}
