/** In-place radix-2 forward FFT, shared by RF and real multiplex spectra. */
export function fft(re: Float64Array, im: Float64Array): void {
  const size = re.length;
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
          k = p + len / 2;
        const tr = r * re[k] - q * im[k],
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
}
