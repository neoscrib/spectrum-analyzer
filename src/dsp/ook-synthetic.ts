/** Deterministic PWM binary ASK fixture at 433.92 MHz. Eight bits A6, 500/1000 µs
 * highs with 500 µs lows, once/second; alternating OOK and nonzero-low ASK. */
export class OokTestSignal {
  private n = 0;
  private re = 1;
  private im = 0;
  private rng = 1;
  process(center: number, count = 65536): Uint8Array {
    const iq = new Uint8Array(count * 2),
      rate = 2400000;
    const step = (2 * Math.PI * (433920000 - center)) / rate,
      wr = Math.cos(step),
      wi = Math.sin(step);
    const widths = [1000, 500, 1000, 500, 500, 1000, 1000, 500]; // A6
    for (let i = 0; i < count; i++, this.n++) {
      const second = Math.floor(this.n / rate),
        us = (this.n % rate) / 2.4;
      let at = 100000,
        high = false;
      for (const width of widths) {
        if (us >= at && us < at + width) high = true;
        at += width + 500;
      }
      const amplitude =
        Math.abs(433920000 - center) > 1100000
          ? 0
          : high
            ? 55
            : second % 2
              ? 10
              : 0;
      this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
      const a = (this.rng >>> 24) / 256 - 0.5;
      this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
      const b = (this.rng >>> 24) / 256 - 0.5;
      iq[i * 2] = Math.round(127.5 + amplitude * this.re + a);
      iq[i * 2 + 1] = Math.round(127.5 + amplitude * this.im + b);
      const r = this.re * wr - this.im * wi;
      this.im = this.re * wi + this.im * wr;
      this.re = r;
      if (this.n % 4096 === 0) {
        const length = Math.hypot(this.re, this.im);
        this.re /= length;
        this.im /= length;
      }
    }
    return iq;
  }
}
