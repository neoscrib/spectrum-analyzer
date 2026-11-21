export interface Rtl433Module {
  HEAPU8: Uint8Array;
  onDecoded?: (json: string) => void;
  _rtl_init(selection: number, frequency: number, level: number): number;
  _rtl_process(pointer: number, bytes: number): number;
  _rtl_free(): void;
  _rtl_protocols(): number;
  _rtl_stats(): number;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  UTF8ToString(pointer: number): string;
}
export default function createRtl433(options?: {
  locateFile?: (path: string) => string;
  wasmBinary?: Uint8Array;
  onDecoded?: (json: string) => void;
  printErr?: (text: string) => void;
}): Promise<Rtl433Module>;
