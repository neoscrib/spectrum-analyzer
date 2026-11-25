export interface AdsbModule {
  HEAPU8: Uint8Array;
  _adsb_init(fix: number): number;
  _adsb_process(pointer: number, bytes: number, firstSample: number): number;
  _adsb_finish(): void;
  _adsb_take(): number;
  _adsb_stats(): number;
  _adsb_frame(pointer: number, bytes: number, seconds: number): number;
  _adsb_cpr(
    type: number,
    lat: number,
    lon: number,
    elat: number,
    elon: number,
    olat: number,
    olon: number,
    odd: number,
    surface: number,
  ): number;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  UTF8ToString(pointer: number): string;
}
export default function createAdsb(options?: {
  locateFile?: (path: string) => string;
  wasmBinary?: Uint8Array;
}): Promise<AdsbModule>;
