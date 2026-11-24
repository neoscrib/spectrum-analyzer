export interface DecoderModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _browser_init(
    rate: number,
    symbolRate: number,
    oqpsk: number,
    nrzm: number,
    interleaved: number,
  ): void;
  _browser_close(): void;
  _browser_feed(ptr: number, count: number): void;
  _browser_tune(hz: number): void;
  _browser_reacquire_after(seconds: number): void;
  _browser_carrier_limit(hz: number): void;
  _browser_stat(id: number): number;
  _browser_carrier(): number;
  _browser_bias_enable(enabled: number): void;
  _browser_bias_iq(): number;
  _browser_bias_count(): number;
  _browser_bias_rate(): number;
  _browser_bias_tune(hz: number, preserve: number): void;
  _browser_pixels(channel: number): number;
  _browser_height(channel: number): number;
  _browser_constellation(): number;
}
export default function createDecoder(options?: {
  wasmBinary?: Uint8Array;
  locateFile?: (name: string) => string;
}): Promise<DecoderModule>;
