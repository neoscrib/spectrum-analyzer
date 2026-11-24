/** Independent test encoder for NRSC-4 / IEC 62106 data-stream 0.
 * Only used by the generated FM fixture; never mixed into received IQ. */
export const RDS_TEST_PI = 0x1234;
export const RDS_TEST_PS = "SPECTRUM";
export const RDS_TEST_TEXT = "Spectrum SDR - browser WASM RDS/RBDS demo";

export function encodeRdsBlock(word: number, offset: number): number {
  // Serial polynomial division, independently implemented from the receiver.
  let check = 0;
  for (let bit = 15; bit >= -10; bit--) {
    check = (check << 1) | (bit >= 0 ? (word >>> bit) & 1 : 0);
    if (check & 0x400) check ^= 0x5b9;
  }
  return (word << 10) | (check ^ offset);
}

export function rdsTestGroups(): number[][] {
  const text = (RDS_TEST_TEXT + "\r").padEnd(64, " ");
  const groups: number[][] = [];
  const common = 0x0400 | (10 << 5); // TP and PTY 10, interpreted by the UI region.
  for (
    let segment = 0;
    segment < Math.ceil((RDS_TEST_TEXT.length + 1) / 4);
    segment++
  ) {
    const ps = segment % 4;
    groups.push([
      RDS_TEST_PI,
      common | 8 | ps,
      0,
      (RDS_TEST_PS.charCodeAt(ps * 2) << 8) |
        RDS_TEST_PS.charCodeAt(ps * 2 + 1),
    ]);
    const at = segment * 4;
    groups.push([
      RDS_TEST_PI,
      common | 0x2000 | segment,
      (text.charCodeAt(at) << 8) | text.charCodeAt(at + 1),
      (text.charCodeAt(at + 2) << 8) | text.charCodeAt(at + 3),
    ]);
  }
  const mjd = Date.UTC(2026, 10, 24) / 86400000 + 40587;
  const hour = 18,
    minute = 30;
  groups.push([
    RDS_TEST_PI,
    common | 0x4000 | (mjd >>> 15),
    ((mjd & 0x7fff) << 1) | (hour >>> 4),
    ((hour & 15) << 12) | (minute << 6) | 0x20 | 12,
  ]); // UTC−06:00.
  return groups;
}

export class RdsTestEncoder {
  private symbols: number[];
  private first = 0;
  private second = 0;
  private alpha: number;
  private phase = 0;
  private symbol = 0;
  private step: number;
  constructor(sampleRate: number) {
    this.step = 1187.5 / sampleRate;
    const bits: number[] = [];
    const offsets = [0x0fc, 0x198, 0x168, 0x1b4];
    // Two cycles make the differential waveform periodic regardless of parity.
    const groups = rdsTestGroups();
    for (const group of [...groups, ...groups]) {
      group.forEach((word, index) => {
        const code = encodeRdsBlock(word, offsets[index]);
        for (let bit = 25; bit >= 0; bit--) bits.push((code >>> bit) & 1);
      });
    }
    let previous = 0;
    this.symbols = bits.map((bit) => {
      previous ^= bit;
      return previous ? 1 : -1;
    });
    this.alpha = 1 - Math.exp((-2 * Math.PI * 2400) / sampleRate);
  }
  sample(): number {
    const symbol = this.symbols[this.symbol] * (this.phase < 0.5 ? 1 : -1);
    this.phase += this.step;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.symbol = (this.symbol + 1) % this.symbols.length;
    }
    // Smooth the test biphase chips to confine most energy around 57 kHz.
    this.first += this.alpha * (symbol - this.first);
    this.second += this.alpha * (this.first - this.second);
    return this.second;
  }
}
