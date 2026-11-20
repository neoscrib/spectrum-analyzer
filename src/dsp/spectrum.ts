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
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const a = (-2 * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a);
    for (let i = 0; i < size; i += len) {
      let r = 1,
        q = 0;
      for (let j = 0; j < len / 2; j++) {
        const p = i + j,
          k = p + len / 2,
          tr = r * re[k] - q * im[k],
          ti = r * im[k] + q * re[k];
        re[k] = re[p] - tr;
        im[k] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
        const n = r * wr - q * wi;
        q = r * wi + q * wr;
        r = n;
      }
    }
  }
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const p = (i + size / 2) % size;
    out[i] =
      10 * Math.log10((re[p] ** 2 + im[p] ** 2) / (size * 0.5) ** 2 + 1e-12);
  }
  return out;
}
