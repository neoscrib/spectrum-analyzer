/** Independent wire/PPM generator. All aircraft in this fixture are synthetic. */
export const KNOWN_FRAMES = [
  "8D4840D6202CC371C32CE0576098",
  "8D40621D58C382D690C8AC2863A7",
  "8D40621D58C386435CC412692AD6",
  "8D485020994409940838175B284F",
];
export function crc(bytes: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < bytes.length - 3; i++) {
    c ^= bytes[i] << 16;
    for (let bit = 0; bit < 8; bit++)
      c = ((c << 1) ^ (c & 0x800000 ? 0xfff409 : 0)) & 0xffffff;
  }
  return (
    c ^
    (bytes[bytes.length - 3] << 16) ^
    (bytes[bytes.length - 2] << 8) ^
    bytes[bytes.length - 1]
  );
}
export function withParity(bytes: Uint8Array, overlay = 0): string {
  const c = crc(bytes) ^ overlay;
  bytes[bytes.length - 3] = c >>> 16;
  bytes[bytes.length - 2] = c >>> 8;
  bytes[bytes.length - 1] = c;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
export function bits(a: Uint8Array, start: number, end: number, value: number) {
  for (let b = end; b >= start; b--) {
    const index = b - 1;
    a[index >> 3] =
      (a[index >> 3] & ~(1 << (7 - (index & 7)))) |
      ((value & 1) << (7 - (index & 7)));
    value = Math.floor(value / 2);
  }
}
export function frame(
  address: number,
  me: Uint8Array,
  df = 17,
  capability = 5,
) {
  const out = new Uint8Array(14);
  out[0] = (df << 3) | capability;
  out[1] = address >>> 16;
  out[2] = address >>> 8;
  out[3] = address;
  out.set(me, 4);
  return withParity(out);
}
export function identification(address: number, name: string) {
  const me = new Uint8Array(7);
  bits(me, 1, 5, 4);
  for (let n = 0; n < 8; n++) {
    const ch = name.padEnd(8, " ")[n],
      code =
        ch === " "
          ? 32
          : /[0-9]/.test(ch)
            ? ch.charCodeAt(0)
            : ch.charCodeAt(0) - 64;
    bits(me, 9 + 6 * n, 14 + 6 * n, code);
  }
  return frame(address, me);
}
function nl(lat: number) {
  if (Math.abs(lat) >= 87) return Math.abs(lat) > 87 ? 1 : 2;
  const r = Math.PI / 180;
  return Math.floor(
    (2 * Math.PI) /
      Math.acos(1 - (1 - Math.cos(Math.PI / 30)) / Math.cos(lat * r) ** 2),
  );
}
export function positionFrame(
  address: number,
  lat: number,
  lon: number,
  odd: boolean,
  surface = false,
  altitude = 12000,
) {
  const me = new Uint8Array(7);
  bits(me, 1, 5, surface ? 5 : 11);
  if (surface) bits(me, 6, 12, 30);
  else {
    const n = Math.round((altitude + 1000) / 25);
    bits(me, 9, 20, ((n & 0x7f0) << 1) | (n & 15) | 16);
  }
  const dlat = (surface ? 90 : 360) / (60 - (odd ? 1 : 0)),
    dlon = (surface ? 90 : 360) / Math.max(1, nl(lat) - (odd ? 1 : 0));
  const enc = (x: number, d: number) =>
    Math.floor(((((x % d) + d) % d) / d) * 131072 + 0.5) % 131072;
  bits(me, 22, 22, odd ? 1 : 0);
  bits(me, 23, 39, enc(lat, dlat));
  bits(me, 40, 56, enc(lon, dlon));
  return frame(address, me);
}
export function velocityFrame(address: number) {
  const me = new Uint8Array(7);
  bits(me, 1, 5, 19);
  bits(me, 6, 8, 1);
  bits(me, 15, 24, 121);
  bits(me, 26, 35, 161);
  bits(me, 37, 37, 1);
  bits(me, 39, 47, 9);
  return frame(address, me);
}
export function demoFrames(time = 0) {
  const frames: string[] = [];
  for (let n = 0; n < 6; n++) {
    const id = 0xa00001 + n,
      lat = 45.75 + n * 0.08 + time * 0.0001,
      lon = -93.6 + n * 0.2 + time * 0.0001;
    frames.push(
      identification(id, `TEST${n + 1}`),
      positionFrame(id, lat, lon, false, false, 8000 + n * 4000),
      positionFrame(id, lat, lon, true, false, 8000 + n * 4000),
      velocityFrame(id),
    );
  }
  return frames;
}
export interface PpmBurst {
  hex: string;
  start: number;
  amplitude?: number;
}
/** Integrate pulse amplitude over each ADC aperture (16 sub-samples), rather
 * than treating 1 Mbps symbols as an integer number of 2.4 MSPS samples. */
export function ppmIq(
  count: number,
  bursts: PpmBurst[],
  first = 0,
  noise = 1.5,
  seed = 1234567,
  clockPpm = 0,
  carrierHz = 125000,
): Uint8Array {
  const output = new Uint8Array(count * 2);
  const pulses = bursts
    .filter(
      (b) =>
        b.start < first + count &&
        b.start + (8 + b.hex.length * 4) * 2.4 > first,
    )
    .map((b) => ({
      bits: Uint8Array.from(b.hex.match(/../g)!, (h) => parseInt(h, 16)),
      start: b.start,
      amplitude: b.amplitude ?? 85,
    }));
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296 - 0.5) * 2;
  };
  for (let i = 0; i < count; i++) {
    let amp = 0;
    for (const b of pulses) {
      const us = ((first + i - b.start) / 2.4) * (1 + clockPpm / 1e6);
      if (us < -0.5 || us > 8 + b.bits.length * 8 + 0.5) continue;
      let level = 0;
      for (let s = 0; s < 16; s++) {
        const t = us + ((s + 0.5) / 16 / 2.4) * (1 + clockPpm / 1e6);
        if (t < 0) continue;
        if (t < 8) {
          if ([0, 1, 3.5, 4.5].some((p) => t >= p && t < p + 0.5)) level++;
        } else {
          const bit = Math.floor(t - 8);
          if (bit >= b.bits.length * 8) continue;
          const one = !!(b.bits[bit >> 3] & (1 << (7 - (bit & 7))));
          const phase = t - 8 - bit;
          if (one ? phase < 0.5 : phase >= 0.5) level++;
        }
      }
      amp += (b.amplitude * level) / 16;
    }
    const phase = ((first + i) * 2 * Math.PI * carrierHz) / 2400000;
    output[i * 2] = Math.max(
      0,
      Math.min(
        255,
        Math.round(127.5 + amp * Math.cos(phase) + noise * random()),
      ),
    );
    output[i * 2 + 1] = Math.max(
      0,
      Math.min(
        255,
        Math.round(127.5 + amp * Math.sin(phase) + noise * random()),
      ),
    );
  }
  return output;
}
export class AdsbTestSignal {
  private at = 0;
  process(_center: number, count = 65536) {
    const period = 1200000,
      cycle = Math.floor(this.at / period),
      bursts: PpmBurst[] = [];
    for (let c = Math.max(0, cycle - 1); c <= cycle + 1; c++)
      demoFrames(c / 2).forEach((hex, n) =>
        bursts.push({ hex, start: c * period + 500 + n * 1200 }),
      );
    const iq = ppmIq(count, bursts, this.at);
    this.at += count;
    return iq;
  }
}
