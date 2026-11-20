import { SAMPLE_RATE } from "../model";
/** Two explicitly synthetic AM stations: 1 kHz at 120.100 MHz, 3 kHz at
 * 120.140 MHz. This exercises carrier selection and adjacent-channel rejection. */
export class AmTestSignal {
  private n = 0;
  private re = 1;
  private im = 0;
  private otherRe = 1;
  private otherIm = 0;
  process(center: number, count = 65536): Uint8Array {
    const iq = new Uint8Array(count * 2);
    const step = (2 * Math.PI * (120100000 - center)) / SAMPLE_RATE,
      other = (2 * Math.PI * (120140000 - center)) / SAMPLE_RATE;
    const wr = Math.cos(step),
      wi = Math.sin(step),
      or = Math.cos(other),
      oi = Math.sin(other);
    for (let i = 0; i < count; i++, this.n++) {
      // Evaluate at the RF sample rate: holding 48 kHz envelope samples would
      // introduce AM images around 48 kHz that can enter the neighboring channel.
      const t = this.n / SAMPLE_RATE;
      const amplitude = 50 * (1 + 0.6 * Math.sin(2 * Math.PI * 1000 * t));
      const otherAmplitude = 20 * (1 + 0.4 * Math.sin(2 * Math.PI * 3000 * t));
      iq[i * 2] = Math.round(
        127.5 + amplitude * this.re + otherAmplitude * this.otherRe,
      );
      iq[i * 2 + 1] = Math.round(
        127.5 + amplitude * this.im + otherAmplitude * this.otherIm,
      );
      const r = this.re * wr - this.im * wi;
      this.im = this.re * wi + this.im * wr;
      this.re = r;
      const r2 = this.otherRe * or - this.otherIm * oi;
      this.otherIm = this.otherRe * oi + this.otherIm * or;
      this.otherRe = r2;
      if (this.n % 4096 === 0) {
        const a = Math.hypot(this.re, this.im),
          b = Math.hypot(this.otherRe, this.otherIm);
        this.re /= a;
        this.im /= a;
        this.otherRe /= b;
        this.otherIm /= b;
      }
    }
    return iq;
  }
}
