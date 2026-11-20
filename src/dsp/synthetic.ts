import { SAMPLE_RATE } from "../model";
/** Stereo test fixture: 100.1 MHz, left 1 kHz / right 2 kHz, 19 kHz pilot.
 * Two unmodulated neighboring carriers and low-level noise exercise the spectrum.
 * This is a generated test source, never presented as RF reception. */
export class TestSignal {
  private n = 0;
  private phase = 0;
  private seed = 12345;
  process(center: number, count = 65536): Uint8Array {
    const iq = new Uint8Array(count * 2);
    for (let i = 0; i < count; i++, this.n++) {
      const time = this.n / SAMPLE_RATE;
      const left = 0.6 * Math.sin(2 * Math.PI * 1000 * time);
      const right = 0.6 * Math.sin(2 * Math.PI * 2000 * time);
      const pilotPhase = 2 * Math.PI * 19000 * time + 0.7;
      const multiplex =
        (left + right) / 2 +
        ((left - right) / 2) * Math.sin(2 * pilotPhase) +
        0.09 * Math.sin(pilotPhase);
      this.phase +=
        (2 * Math.PI * (100_100_000 - center + 75_000 * multiplex)) /
        SAMPLE_RATE;
      this.phase %= 2 * Math.PI;
      const a = 2 * Math.PI * (99_350_000 - center) * time;
      const b = 2 * Math.PI * (100_850_000 - center) * time;
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
          15 * Math.cos(a) +
          8 * Math.cos(b) +
          5 * noiseI,
      );
      iq[i * 2 + 1] = Math.round(
        127.5 +
          65 * Math.sin(this.phase) +
          15 * Math.sin(a) +
          8 * Math.sin(b) +
          5 * noiseQ,
      );
    }
    return iq;
  }
}
