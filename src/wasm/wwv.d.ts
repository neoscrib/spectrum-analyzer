/* tslint:disable */
/* eslint-disable */

export class WwvDecoder {
    free(): void;
    [Symbol.dispose](): void;
    constructor(offset_hz: number, bandwidth_hz: number);
    /**
     * Offline audio entry point for protocol verification / future WAV replay.
     * Centered AM audio at exactly 48 kHz, before volume or de-emphasis.
     */
    process_audio(audio: Float32Array | number[]): void;
    /**
     * Normalized F32 I/Q at 240 kSPS from dsp_core.
     */
    process_baseband(iq: Float32Array | number[]): Float32Array;
    status(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wwvdecoder_free: (a: number, b: number) => void;
    readonly wwvdecoder_new: (a: number, b: number) => number;
    readonly wwvdecoder_process_audio: (a: number, b: number, c: number) => void;
    readonly wwvdecoder_process_baseband: (a: number, b: number, c: number) => [number, number];
    readonly wwvdecoder_status: (a: number) => [number, number];
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
