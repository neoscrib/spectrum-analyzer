/* tslint:disable */
/* eslint-disable */

export class WfmDecoder {
    free(): void;
    [Symbol.dispose](): void;
    multiplex_sample_rate(): number;
    constructor(_offset_hz: number, _bandwidth_hz: number, deemphasis_us: number);
    pilot_level(): number;
    /**
     * Interleaved normalized F32 I/Q at 240 kSPS, with owned output PCM.
     */
    process_baseband(iq: Float32Array | number[]): Float32Array;
    rds_status(): string;
    set_multiplex_enabled(enabled: boolean): void;
    set_rds_enabled(enabled: boolean): void;
    set_stereo_enabled(enabled: boolean): void;
    stereo_locked(): boolean;
    /**
     * Owned, full-rate discriminator samples from the most recent block.
     * Disabled by default; no tap allocation/copying occurs while disabled.
     */
    take_multiplex(): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wfmdecoder_free: (a: number, b: number) => void;
    readonly wfmdecoder_multiplex_sample_rate: (a: number) => number;
    readonly wfmdecoder_new: (a: number, b: number, c: number) => number;
    readonly wfmdecoder_pilot_level: (a: number) => number;
    readonly wfmdecoder_process_baseband: (a: number, b: number, c: number) => [number, number];
    readonly wfmdecoder_rds_status: (a: number) => [number, number];
    readonly wfmdecoder_set_multiplex_enabled: (a: number, b: number) => void;
    readonly wfmdecoder_set_rds_enabled: (a: number, b: number) => void;
    readonly wfmdecoder_set_stereo_enabled: (a: number, b: number) => void;
    readonly wfmdecoder_stereo_locked: (a: number) => number;
    readonly wfmdecoder_take_multiplex: (a: number) => [number, number];
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
