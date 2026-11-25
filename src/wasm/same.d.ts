/* tslint:disable */
/* eslint-disable */

export class SameDecoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Drain modem tail using bounded silence, without truncating a last burst.
     */
    finish(): void;
    has_events(): boolean;
    constructor(rate: number);
    process_audio(samples: Float32Array | number[]): void;
    set_attention_enabled(enabled: boolean): void;
    status(): string;
    take_events(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_samedecoder_free: (a: number, b: number) => void;
    readonly samedecoder_finish: (a: number) => void;
    readonly samedecoder_has_events: (a: number) => number;
    readonly samedecoder_new: (a: number) => [number, number, number];
    readonly samedecoder_process_audio: (a: number, b: number, c: number) => void;
    readonly samedecoder_set_attention_enabled: (a: number, b: number) => void;
    readonly samedecoder_status: (a: number) => [number, number];
    readonly samedecoder_take_events: (a: number) => [number, number];
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
