import { SAMPLE_RATE } from "../model";
import { RdsTestEncoder } from "./rds-synthetic";
// The audio tones, stereo pilot/difference carrier and RDS carrier repeat every
// millisecond. Cache those fixed waveforms instead of evaluating five trig
// functions per 2.4 MSPS sample; keep test generation comfortably real-time.
const PERIOD = SAMPLE_RATE / 1000;
const mpx = new Float64Array(PERIOD),
  rdsCarrier = new Float64Array(PERIOD);
for (let n = 0; n < PERIOD; n++) {
  const time = n / SAMPLE_RATE;
  const left = 0.6 * Math.sin(2 * Math.PI * 1000 * time);
  const right = 0.6 * Math.sin(2 * Math.PI * 2000 * time);
  const pilot = 2 * Math.PI * 19000 * time + 0.7;
  mpx[n] =
    (left + right) / 2 +
    ((left - right) / 2) * Math.sin(2 * pilot) +
    0.09 * Math.sin(pilot);
  rdsCarrier[n] = Math.cos(3 * pilot);
}
/** Stereo test fixture: 100.1 MHz, left 1 kHz / right 2 kHz, 19 kHz pilot.
 * CRC-coded RDS at 57 kHz: synthetic SPECTRUM PS, RadioText, PTY and clock.
 * Two unmodulated neighboring carriers and low-level noise exercise the spectrum.
 * This is a generated test source, never presented as RF reception. */
export class TestSignal {
  private n = 0;
  private phase = 0;
  private seed = 12345;
  private rds = new RdsTestEncoder(SAMPLE_RATE);
  private center: number | undefined;
  private a = [1, 0];
  private b = [1, 0];
  private stepA = [1, 0];
  private stepB = [1, 0];
  process(center: number, count = 65536): Uint8Array {
    const iq = new Uint8Array(count * 2);
    if (this.center !== center) {
      this.center = center;
      for (const [frequency, oscillator, step] of [
        [99_350_000, this.a, this.stepA],
        [100_850_000, this.b, this.stepB],
      ] as const) {
        const angle = (2 * Math.PI * (frequency - center)) / SAMPLE_RATE;
        step[0] = Math.cos(angle);
        step[1] = Math.sin(angle);
        oscillator[0] = Math.cos(angle * this.n);
        oscillator[1] = Math.sin(angle * this.n);
      }
    }
    for (let i = 0; i < count; i++, this.n++) {
      const position = this.n % PERIOD;
      const multiplex =
        mpx[position] + 0.045 * this.rds.sample() * rdsCarrier[position];
      this.phase +=
        (2 * Math.PI * (100_100_000 - center + 75_000 * multiplex)) /
        SAMPLE_RATE;
      this.phase %= 2 * Math.PI;
      this.seed ^= this.seed << 13;
      this.seed ^= this.seed >>> 17;
      this.seed ^= this.seed << 5;
      const noiseI = (this.seed >>> 0) / 2 ** 32 - 0.5;
      this.seed ^= this.seed << 13;
      this.seed ^= this.seed >>> 17;
      this.seed ^= this.seed << 5;
      const noiseQ = (this.seed >>> 0) / 2 ** 32 - 0.5;
      iq[i * 2] = Math.round(
        127.5 +
          65 * Math.cos(this.phase) +
          15 * this.a[0] +
          8 * this.b[0] +
          5 * noiseI,
      );
      iq[i * 2 + 1] = Math.round(
        127.5 +
          65 * Math.sin(this.phase) +
          15 * this.a[1] +
          8 * this.b[1] +
          5 * noiseQ,
      );
      const ar = this.a[0] * this.stepA[0] - this.a[1] * this.stepA[1];
      this.a[1] = this.a[0] * this.stepA[1] + this.a[1] * this.stepA[0];
      this.a[0] = ar;
      const br = this.b[0] * this.stepB[0] - this.b[1] * this.stepB[1];
      this.b[1] = this.b[0] * this.stepB[1] + this.b[1] * this.stepB[0];
      this.b[0] = br;
      if (this.n % 4096 === 0) {
        const an = Math.hypot(...this.a),
          bn = Math.hypot(...this.b);
        this.a[0] /= an;
        this.a[1] /= an;
        this.b[0] /= bn;
        this.b[1] /= bn;
      }
    }
    return iq;
  }
}
