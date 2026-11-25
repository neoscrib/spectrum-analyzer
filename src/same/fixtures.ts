// Independent signal construction from 47 CFR 11.31: 16 AB bytes, continuous
// 8-bit words LSB first, no UART start/stop bits. Kept separate from the modem.
export const TEST_HEADER = "ZCZC-WXR-RWT-027065-027095+0030-3281830-TEST    -";
// NWS Instruction 10-1712 (2005), Appendix A.3.2: published code-only vector.
export const NWS_REFERENCE_HEADER =
  "ZCZC-WXR-TOR-039173-039051-139069+0030-1591829-KCLE/NWS-";
export function sameFixture(
  rate = 48000,
  headers = [TEST_HEADER, TEST_HEADER, TEST_HEADER],
  options: {
    ppm?: number;
    frequencyOffset?: number;
    noise?: number;
    distorted?: boolean;
    attention?: "noaa1050" | "easDual";
    eom?: boolean;
    prefixSeconds?: number;
    highPadding?: boolean;
  } = {},
): Float32Array {
  const parts: number[] = [];
  let seed = 3456789,
    phase = 0;
  const add = (sample: number) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const value =
      sample + (options.noise ?? 0) * ((seed >>> 0) / 2147483648 - 1);
    parts.push(
      options.distorted ? Math.max(-0.23, Math.min(0.23, value)) : value,
    );
  };
  const silence = (seconds: number) => {
    for (let n = 0; n < rate * seconds; n++) add(0);
  };
  const burst = (text: string) => {
    const bytes = [
      ...Array<number>(16).fill(0xab),
      ...Array.from(
        text,
        (c) => c.charCodeAt(0) | (options.highPadding ? 0x80 : 0),
      ),
    ];
    const baud = (6250 / 12) * (1 + (options.ppm ?? 0) / 1e6);
    const count = Math.ceil((bytes.length * 8 * rate) / baud);
    for (let n = 0; n < count; n++) {
      const bit = Math.min(bytes.length * 8 - 1, Math.floor((n * baud) / rate));
      const one = (bytes[bit >> 3] >> (bit % 8)) & 1;
      phase +=
        (2 *
          Math.PI *
          ((one ? 6250 / 3 : 6250 / 4) + (options.frequencyOffset ?? 0))) /
        rate;
      add(0.5 * Math.sin(phase));
    }
    silence(1.1);
  };
  silence(options.prefixSeconds ?? 0.237);
  headers.forEach(burst);
  if (options.attention) {
    for (let n = 0; n < rate * 8.4; n++) {
      const t = n / rate;
      add(
        options.attention === "noaa1050"
          ? 0.5 * Math.sin(2 * Math.PI * 1050 * t)
          : 0.25 *
              (Math.sin(2 * Math.PI * 853 * t) +
                Math.sin(2 * Math.PI * 960 * t)),
      );
    }
    silence(0.4);
  }
  if (options.eom !== false) for (let n = 0; n < 3; n++) burst("NNNN");
  silence(6);
  return Float32Array.from(parts);
}
