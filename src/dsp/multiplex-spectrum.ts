import { fft } from "./fft";
import type { MultiplexSpectrum } from "../types";

export const MULTIPLEX_MAX_HZ = 65_000;
export const MULTIPLEX_AVERAGE_SECONDS = 0.6;

/** Streaming, Hann-windowed real FFT. Average LINEAR bin power before dB.
 * Unit amplitude is the discriminator's 75 kHz full-deviation reference;
 * this is a tone-level spectrum, not RF dBm or a power spectral density. */
export class MultiplexAnalyzer {
  private input: Float64Array;
  private re: Float64Array;
  private im: Float64Array;
  private window: Float64Array;
  private power: Float64Array;
  private at = 0;
  private sumWindow: number;
  private alpha: number;
  averages = 0;

  constructor(
    readonly sampleRate: number,
    readonly fftSize = 4096,
  ) {
    if (!Number.isFinite(sampleRate) || sampleRate / 2 < MULTIPLEX_MAX_HZ)
      throw Error("The multiplex sample rate must cover 65 kHz.");
    if (
      !Number.isInteger(fftSize) ||
      fftSize < 16 ||
      (fftSize & (fftSize - 1)) !== 0
    )
      throw Error("FFT size must be a power of two.");
    this.input = new Float64Array(fftSize);
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    this.window = Float64Array.from(
      { length: fftSize },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)),
    );
    this.sumWindow = this.window.reduce((sum, value) => sum + value, 0);
    this.power = new Float64Array(
      Math.min(
        fftSize / 2,
        Math.ceil((MULTIPLEX_MAX_HZ * fftSize) / sampleRate),
      ) + 1,
    );
    this.alpha =
      1 - Math.exp(-fftSize / (sampleRate * MULTIPLEX_AVERAGE_SECONDS));
  }

  push(samples: Float32Array): void {
    for (const sample of samples) {
      this.input[this.at++] = sample;
      if (this.at !== this.fftSize) continue;
      this.at = 0;
      // Suppress tuning DC without filtering away any multiplex subcarrier.
      const mean =
        this.input.reduce((sum, value) => sum + value, 0) / this.fftSize;
      for (let i = 0; i < this.fftSize; i++) {
        this.re[i] = (this.input[i] - mean) * this.window[i];
        this.im[i] = 0;
      }
      fft(this.re, this.im);
      for (let i = 0; i < this.power.length; i++) {
        const scale = i === 0 || i === this.fftSize / 2 ? 1 : 4;
        const value =
          (scale * (this.re[i] ** 2 + this.im[i] ** 2)) / this.sumWindow ** 2;
        this.power[i] =
          this.averages === 0
            ? value
            : this.power[i] + this.alpha * (value - this.power[i]);
      }
      this.averages++;
    }
  }

  snapshot(): MultiplexSpectrum {
    return {
      bins: Float32Array.from(
        this.power,
        (value) => 10 * Math.log10(Math.max(value, 1e-16)),
      ),
      sampleRate: this.sampleRate,
      fftSize: this.fftSize,
      averages: this.averages,
    };
  }
}
