/* tslint:disable */
/* eslint-disable */

/**
 * Shared runtime DDC. All calls process blocks; no per-sample JS callbacks.
 */
export class Channelizer {
    free(): void;
    [Symbol.dispose](): void;
    constructor(offset: number, cutoff: number, taps: number, decimation: number);
    /**
     * CU8 2.4 MSPS -> owned interleaved normalized F32 I/Q at 2.4M / decimation.
     */
    process(iq: Uint8Array | number[]): Float32Array;
}

export class IqChannelizer {
    free(): void;
    [Symbol.dispose](): void;
    constructor(offset_hz: number, bandwidth_hz: number);
    /**
     * 2.4 MSPS CU8 -> 240 kSPS interleaved signed 16-bit I/Q.
     */
    process(iq: Uint8Array | number[]): Int16Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_channelizer_free: (a: number, b: number) => void;
    readonly __wbg_iqchannelizer_free: (a: number, b: number) => void;
    readonly channelizer_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly channelizer_process: (a: number, b: number, c: number) => [number, number];
    readonly iqchannelizer_new: (a: number, b: number) => number;
    readonly iqchannelizer_process: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
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
