/** Explicitly synthetic FRS IQ. Overlapping calls exercise parallel receivers;
 * the second RF window has a separate station. No recorded radio traffic. */
export class NfmTestSignal {
  private sample = 0;
  private phases = [0, 0, 0];
  private dcs = 0;
  private seed = 12345;
  process(center: number, count = 65536) {
    const iq = new Uint8Array(count * 2),
      rate = 2400000;
    const frequencies = [462562500, 462587500, 467562500];
    for (let at = 0; at < count; at++, this.sample++) {
      const t = this.sample / rate,
        cycle = t % 12;
      const bit = Math.floor(t * 134.4) % 23;
      const symbol = (0b11101100011100000010011 >>> bit) & 1; // ETSI's published DCS 023 word, LSB first.
      this.dcs += 0.0006 * ((symbol ? 400 : -400) - this.dcs);
      const active = [
        cycle >= 0.5 && cycle < 3.4,
        cycle >= 1.4 && cycle < 5.8,
        cycle >= 6.5 && cycle < 10.5,
      ];
      const modulation = [
        1600 * Math.sin(2 * Math.PI * 1000 * t) +
          350 * Math.sin(2 * Math.PI * 100 * t),
        1600 * Math.sin(2 * Math.PI * 1500 * t) + this.dcs,
        1600 * Math.sin(2 * Math.PI * 2000 * t) +
          350 * Math.sin(2 * Math.PI * 88.5 * t),
      ];
      let i = 128,
        q = 128;
      for (let ch = 0; ch < 3; ch++) {
        this.phases[ch] =
          (this.phases[ch] +
            (2 * Math.PI * (frequencies[ch] - center + modulation[ch])) /
              rate) %
          (2 * Math.PI);
        if (active[ch] && Math.abs(frequencies[ch] - center) < 1150000) {
          i += 42 * Math.cos(this.phases[ch]);
          q += 42 * Math.sin(this.phases[ch]);
        }
      }
      // Uncorrelated dither prevents quantizer tones becoming spurious carriers.
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      iq[at * 2] = Math.round(i + ((this.seed >>> 8) / 16777216 - 0.5) * 1.1);
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      iq[at * 2 + 1] = Math.round(
        q + ((this.seed >>> 8) / 16777216 - 0.5) * 1.1,
      );
    }
    return iq;
  }
}
