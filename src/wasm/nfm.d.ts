/* tslint:disable */
/* eslint-disable */

export class NfmDecoder {
    free(): void;
    [Symbol.dispose](): void;
    constructor(offset: number, bandwidth: number, deviation: number, squelch: number);
    process(iq: Uint8Array | number[]): Float32Array;
    /**
     * CU8 2.4 MSPS -> interleaved 48 kHz mono PCM. State survives arbitrary chunks.
     */
    set_audio_tap_enabled(enabled: boolean): void;
    status(): string;
    take_audio_tap(): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_nfmdecoder_free: (a: number, b: number) => void;
    readonly nfmdecoder_new: (a: number, b: number, c: number, d: number) => number;
    readonly nfmdecoder_process: (a: number, b: number, c: number) => [number, number];
    readonly nfmdecoder_set_audio_tap_enabled: (a: number, b: number) => void;
    readonly nfmdecoder_status: (a: number) => [number, number];
    readonly nfmdecoder_take_audio_tap: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
