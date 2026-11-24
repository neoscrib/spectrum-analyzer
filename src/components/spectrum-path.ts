/** Shared peak-preserving canvas trace for RF and multiplex plots. */
export function spectrumPath(
  ctx: CanvasRenderingContext2D,
  values: Float32Array,
  left: number,
  width: number,
  binsForPixel: (pixel: number) => [number, number],
  yFor: (db: number) => number,
): void {
  ctx.beginPath();
  for (let px = 0; px < width; px++) {
    const [lo, hi] = binsForPixel(px);
    let value = -160;
    for (let bin = lo; bin < hi; bin++) value = Math.max(value, values[bin]);
    const y = yFor(value);
    if (px === 0) ctx.moveTo(left, y);
    else ctx.lineTo(left + px, y);
  }
}
