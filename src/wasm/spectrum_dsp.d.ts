/* tslint:disable */
/* eslint-disable */

export class AmDecoder {
    free(): void;
    [Symbol.dispose](): void;
    constructor(offset_hz: number, bandwidth_hz: number);
    /**
     * 2.4 MSPS CU8 -> 48 kHz mono audio duplicated into interleaved L/R.
     */
    process(iq: Uint8Array | number[]): Float32Array;
}

/**
 * Deterministic CU8 C4FM fixture, not real radio traffic or intelligible speech.
 * It exercises CRC-valid band/site/grants and the actual IMBE decoder.
 */
export class ArmerTestSource {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    process(center: number, count: number): Uint8Array;
}

export class Receiver {
    free(): void;
    [Symbol.dispose](): void;
    audio_talkgroup(): number;
    constructor(center: number, control: number, rate: number);
    process(iq: Uint8Array | number[]): void;
    /**
     * O(1) per-grant membership, equal priority for all enabled groups. A fresh
     * all-talkgroups policy must not preempt calls just because an ID is lower.
     */
    set_enabled(enabled: Uint8Array | number[]): boolean;
    set_listen(groups: Uint16Array | number[], hold: number): void;
    stats(): string;
    take_audio(): Float32Array;
    take_events(): string;
}

export class WfmDecoder {
    free(): void;
    [Symbol.dispose](): void;
    constructor(offset_hz: number, bandwidth_hz: number, deemphasis_us: number);
    pilot_level(): number;
    process(iq: Uint8Array | number[]): Float32Array;
    set_stereo_enabled(enabled: boolean): void;
    stereo_locked(): boolean;
}

export class WwvDecoder {
    free(): void;
    [Symbol.dispose](): void;
    constructor(offset_hz: number, bandwidth_hz: number);
    process(iq: Uint8Array | number[]): Float32Array;
    /**
     * Offline audio entry point for protocol verification / future WAV replay.
     * Centered AM audio at exactly 48 kHz, before volume or de-emphasis.
     */
    process_audio(audio: Float32Array | number[]): void;
    status(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_amdecoder_free: (a: number, b: number) => void;
    readonly __wbg_armertestsource_free: (a: number, b: number) => void;
    readonly __wbg_receiver_free: (a: number, b: number) => void;
    readonly __wbg_wfmdecoder_free: (a: number, b: number) => void;
    readonly __wbg_wwvdecoder_free: (a: number, b: number) => void;
    readonly amdecoder_new: (a: number, b: number) => number;
    readonly amdecoder_process: (a: number, b: number, c: number) => [number, number];
    readonly armertestsource_new: () => number;
    readonly armertestsource_process: (a: number, b: number, c: number) => [number, number];
    readonly receiver_audio_talkgroup: (a: number) => number;
    readonly receiver_new: (a: number, b: number, c: number) => [number, number, number];
    readonly receiver_process: (a: number, b: number, c: number) => void;
    readonly receiver_set_enabled: (a: number, b: number, c: number) => number;
    readonly receiver_set_listen: (a: number, b: number, c: number, d: number) => void;
    readonly receiver_stats: (a: number) => [number, number];
    readonly receiver_take_audio: (a: number) => [number, number];
    readonly receiver_take_events: (a: number) => [number, number];
    readonly wfmdecoder_new: (a: number, b: number, c: number) => number;
    readonly wfmdecoder_pilot_level: (a: number) => number;
    readonly wfmdecoder_process: (a: number, b: number, c: number) => [number, number];
    readonly wfmdecoder_set_stereo_enabled: (a: number, b: number) => void;
    readonly wfmdecoder_stereo_locked: (a: number) => number;
    readonly wwvdecoder_new: (a: number, b: number) => number;
    readonly wwvdecoder_process: (a: number, b: number, c: number) => [number, number];
    readonly wwvdecoder_process_audio: (a: number, b: number, c: number) => void;
    readonly wwvdecoder_status: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
