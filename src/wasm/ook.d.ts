/* tslint:disable */
/* eslint-disable */

export class OokDecoder {
    free(): void;
    [Symbol.dispose](): void;
    constructor(_offset_hz: number, bandwidth_hz: number, threshold_db: number, min_pulse_us: number, gap_us: number);
    /**
     * Normalized F32 I/Q at 240 kSPS from dsp_core.
     */
    process_baseband(iq: Float32Array | number[]): void;
    status(): string;
    take_bursts(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_ookdecoder_free: (a: number, b: number) => void;
    readonly ookdecoder_new: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly ookdecoder_process_baseband: (a: number, b: number, c: number) => void;
    readonly ookdecoder_status: (a: number) => [number, number];
    readonly ookdecoder_take_bursts: (a: number) => [number, number];
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
