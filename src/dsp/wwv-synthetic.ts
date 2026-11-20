import { SAMPLE_RATE } from "../model";
import { WwvAudioFixture } from "./wwv-fixture";
/** Real CU8 AM IQ fed through the normal WASM DDC and decoder. */
export class WwvTestSignal {
  private n = 0;
  private re = 1;
  private im = 0;
  private amplitude = 65;
  private fixture = new WwvAudioFixture();
  process(center: number, count = 65536): Uint8Array {
    const iq = new Uint8Array(count * 2),
      angle = (2 * Math.PI * (25000000 - center)) / SAMPLE_RATE;
    const wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < count; i++, this.n++) {
      if (this.n % 50 === 0)
        this.amplitude = 65 * (1 + this.fixture.sample(this.n / SAMPLE_RATE));
      iq[i * 2] = Math.max(
        0,
        Math.min(255, Math.round(127.5 + this.amplitude * this.re)),
      );
      iq[i * 2 + 1] = Math.max(
        0,
        Math.min(255, Math.round(127.5 + this.amplitude * this.im)),
      );
      const re = this.re * wr - this.im * wi;
      this.im = this.re * wi + this.im * wr;
      this.re = re;
      if (this.n % 4096 === 0) {
        const norm = Math.hypot(this.re, this.im);
        this.re /= norm;
        this.im /= norm;
      }
    }
    return iq;
  }
}
