/** Receive-only fixtures, generated from the upstream published bit layouts.
 * Nexus-TH: ID 66, channel 1, 21.5 C / 56% RH. Gen3 FSK: fabricated opaque
 * bytes with a valid wire CRC, not real ciphertext or an authenticated command.
 * Nothing in this module transmits RF. */
function crc16(bytes: number[]) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x8005 : 0)) & 0xffff;
  }
  return crc;
}
const frame = [
  0x16, 2, 0x12, 0x34, 0x56, 0x78, 1, 0, 0, 0x11, 0x22, 0x33, 0x44, 0x10, 0x20,
  0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0,
];
const crc = crc16(frame);
const fskBits = [
  0xaa,
  0xaa,
  0xaa,
  0xaa,
  0x93,
  0x0b,
  0x51,
  0xde,
  ...frame,
  crc >> 8,
  crc & 255,
  0,
  0,
  0,
  0,
].flatMap((b) => Array.from({ length: 8 }, (_, bit) => (b >> (7 - bit)) & 1));
const nexusBits = [..."4280d7f38"].flatMap((n) =>
  Array.from({ length: 4 }, (_, bit) => (parseInt(n, 16) >> (3 - bit)) & 1),
);
const envelope = new Uint8Array(300000);
let end = 200000;
for (let repeat = 0; repeat < 12; repeat++) {
  for (const bit of nexusBits) {
    envelope.fill(1, end / 10, (end + 500) / 10);
    end += 500 + (bit ? 2000 : 1000);
  }
  envelope.fill(1, end / 10, (end + 500) / 10);
  end += 4500;
}
export class Rtl433TestSignal {
  private n = 0;
  private phase = 0;
  private rng = 1;
  process(center: number, count = 65536): Uint8Array {
    const iq = new Uint8Array(count * 2),
      rate = 2400000;
    for (let i = 0; i < count; i++, this.n++) {
      const us = (this.n % (rate * 3)) / 2.4;
      const bit = Math.floor((us - 1800000) * 0.0048);
      const fsk = bit >= 0 && bit < fskBits.length;
      const high = !fsk && envelope[Math.floor(us / 10)] === 1;
      const amplitude =
        Math.abs(433920000 - center) > 1100000 ? 0 : fsk || high ? 55 : 0;
      this.phase +=
        (2 *
          Math.PI *
          (433920000 - center + (fsk ? (fskBits[bit] ? 12500 : -12500) : 0))) /
        rate;
      if (this.phase > Math.PI) this.phase -= 2 * Math.PI;
      if (this.phase < -Math.PI) this.phase += 2 * Math.PI;
      this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
      const noise = (this.rng >>> 24) / 256 - 0.5;
      iq[i * 2] = Math.round(127.5 + amplitude * Math.cos(this.phase) + noise);
      iq[i * 2 + 1] = Math.round(
        127.5 + amplitude * Math.sin(this.phase) - noise,
      );
    }
    return iq;
  }
}
