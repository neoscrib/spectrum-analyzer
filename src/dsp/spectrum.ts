import { fft } from "./fft";
/** Hann-windowed, shifted FFT. Values are dBFS per bin, not calibrated dBm. */
export function spectrum(iq: Uint8Array, size = 2048): Float32Array {
  const re = new Float64Array(size),
    im = new Float64Array(size);
  const offset = Math.max(0, iq.length - size * 2);
  let meanI = 0,
    meanQ = 0;
  for (let i = 0; i < size; i++) {
    meanI += iq[offset + i * 2] ?? 127.5;
    meanQ += iq[offset + i * 2 + 1] ?? 127.5;
  }
  meanI /= size;
  meanQ /= size;
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = (((iq[offset + 2 * i] ?? 127.5) - meanI) / 128) * w;
    im[i] = (((iq[offset + 2 * i + 1] ?? 127.5) - meanQ) / 128) * w;
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
