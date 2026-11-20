/** Independent NIST-format test encoder. Fixed test epoch, never computer time. */
export const WWV_TEST_EPOCH = Date.UTC(2026, 10, 20, 12, 33);
export function encodeWwvMinute(epoch: number): number[] {
  const d = new Date(epoch),
    year = d.getUTCFullYear() % 100;
  const day = Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) /
      86400000,
  );
  const bits = Array<number>(60).fill(0);
  bits[0] = -1;
  for (const i of [9, 19, 29, 39, 49, 59]) bits[i] = 2;
  const put = (value: number, indices: number[]) =>
    indices.forEach((index, n) => {
      bits[index] = (value >> n) & 1;
    });
  put(year % 10, [4, 5, 6, 7]);
  put(Math.floor(year / 10), [51, 52, 53, 54]);
  put(d.getUTCMinutes() % 10, [10, 11, 12, 13]);
  put(Math.floor(d.getUTCMinutes() / 10), [15, 16, 17]);
  put(d.getUTCHours() % 10, [20, 21, 22, 23]);
  put(Math.floor(d.getUTCHours() / 10), [25, 26]);
  put(day % 10, [30, 31, 32, 33]);
  put(Math.floor(day / 10) % 10, [35, 36, 37, 38]);
  put(Math.floor(day / 100), [40, 41]);
  bits[50] = 1;
  bits[56] = 1;
  bits[57] = 1; // DUT1 +0.3 s; DST/leap flags clear.
  return bits;
}
export class WwvAudioFixture {
  private minute = -1;
  private bits: number[] = [];
  sample(t: number): number {
    const absolute = t + 58;
    const minute = Math.floor(absolute / 60);
    if (minute !== this.minute) {
      this.minute = minute;
      this.bits = encodeWwvMinute(WWV_TEST_EPOCH + minute * 60000);
    }
    const second = Math.floor(absolute) % 60,
      phase = absolute - Math.floor(absolute);
    const bit = this.bits[second],
      width = bit === 0 ? 0.17 : bit === 1 ? 0.47 : bit === 2 ? 0.77 : 0;
    const code =
      phase >= 0.03 && phase < 0.03 + width
        ? 0.5 * Math.sin(2 * Math.PI * 100 * t + 0.8)
        : 0;
    const tick =
      (second === 0 && phase < 0.8) ||
      (second !== 29 && second !== 59 && phase < 0.005)
        ? 0.8 * Math.sin(2 * Math.PI * (second === 0 ? 1000 : 1000) * t)
        : 0;
    const tone =
      phase >= 0.04 && phase < 0.99 && second !== 0
        ? 0.15 * Math.sin(2 * Math.PI * 500 * t)
        : 0;
    return code + tick + tone;
  }
}
