/* @ts-self-types="./spectrum_dsp.d.ts" */

export class AmDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AmDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_amdecoder_free(ptr, 0);
    }
    /**
     * @param {number} offset_hz
     * @param {number} bandwidth_hz
     */
    constructor(offset_hz, bandwidth_hz) {
        const ret = wasm.amdecoder_new(offset_hz, bandwidth_hz);
        this.__wbg_ptr = ret;
        AmDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 2.4 MSPS CU8 -> 48 kHz mono audio duplicated into interleaved L/R.
     * @param {Uint8Array | number[]} iq
     * @returns {Float32Array}
     */
    process(iq) {
        const ptr0 = passArray8ToWasm0(iq, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.amdecoder_process(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
}
if (Symbol.dispose) AmDecoder.prototype[Symbol.dispose] = AmDecoder.prototype.free;

/**
 * Deterministic CU8 C4FM fixture, not real radio traffic or intelligible speech.
 * It exercises CRC-valid band/site/grants and the actual IMBE decoder.
 */
export class ArmerTestSource {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ArmerTestSourceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_armertestsource_free(ptr, 0);
    }
    constructor() {
        const ret = wasm.armertestsource_new();
        this.__wbg_ptr = ret;
        ArmerTestSourceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} center
     * @param {number} count
     * @returns {Uint8Array}
     */
    process(center, count) {
        const ret = wasm.armertestsource_process(this.__wbg_ptr, center, count);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) ArmerTestSource.prototype[Symbol.dispose] = ArmerTestSource.prototype.free;

export class NfmDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NfmDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_nfmdecoder_free(ptr, 0);
    }
    /**
     * @param {number} offset
     * @param {number} bandwidth
     * @param {number} deviation
     * @param {number} squelch
     */
    constructor(offset, bandwidth, deviation, squelch) {
        const ret = wasm.nfmdecoder_new(offset, bandwidth, deviation, squelch);
        this.__wbg_ptr = ret;
        NfmDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * CU8 2.4 MSPS -> interleaved 48 kHz mono PCM. State survives arbitrary chunks.
     * @param {Uint8Array | number[]} iq
     * @returns {Float32Array}
     */
    process(iq) {
        const ptr0 = passArray8ToWasm0(iq, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.nfmdecoder_process(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @returns {string}
     */
    status() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.nfmdecoder_status(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) NfmDecoder.prototype[Symbol.dispose] = NfmDecoder.prototype.free;

export class OokDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OokDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ookdecoder_free(ptr, 0);
    }
    /**
     * @param {number} offset_hz
     * @param {number} bandwidth_hz
     * @param {number} threshold_db
     * @param {number} min_pulse_us
     * @param {number} gap_us
     */
    constructor(offset_hz, bandwidth_hz, threshold_db, min_pulse_us, gap_us) {
        const ret = wasm.ookdecoder_new(offset_hz, bandwidth_hz, threshold_db, min_pulse_us, gap_us);
        this.__wbg_ptr = ret;
        OokDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * CU8 at 2.4 MSPS -> complex channel filter -> 120 kSPS magnitude.
     * @param {Uint8Array | number[]} iq
     */
    process(iq) {
        const ptr0 = passArray8ToWasm0(iq, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.ookdecoder_process(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {string}
     */
    status() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.ookdecoder_status(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    take_bursts() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.ookdecoder_take_bursts(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) OokDecoder.prototype[Symbol.dispose] = OokDecoder.prototype.free;

export class Receiver {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ReceiverFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_receiver_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    audio_talkgroup() {
        const ret = wasm.receiver_audio_talkgroup(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} center
     * @param {number} control
     * @param {number} rate
     */
    constructor(center, control, rate) {
        const ret = wasm.receiver_new(center, control, rate);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ReceiverFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array | number[]} iq
     */
    process(iq) {
        const ptr0 = passArray8ToWasm0(iq, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.receiver_process(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * O(1) per-grant membership, equal priority for all enabled groups. A fresh
     * all-talkgroups policy must not preempt calls just because an ID is lower.
     * @param {Uint8Array | number[]} enabled
     * @returns {boolean}
     */
    set_enabled(enabled) {
        const ptr0 = passArray8ToWasm0(enabled, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.receiver_set_enabled(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {Uint16Array | number[]} groups
     * @param {number} hold
     */
    set_listen(groups, hold) {
        const val2 = +hold;
        const ptr0 = passArray16ToWasm0(groups, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.receiver_set_listen(this.__wbg_ptr, ptr0, len0, val2);
    }
    /**
     * @returns {string}
     */
    stats() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.receiver_stats(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Float32Array}
     */
    take_audio() {
        const ret = wasm.receiver_take_audio(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string}
     */
    take_events() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.receiver_take_events(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Receiver.prototype[Symbol.dispose] = Receiver.prototype.free;

export class WfmDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WfmDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wfmdecoder_free(ptr, 0);
    }
    /**
     * @param {number} offset_hz
     * @param {number} bandwidth_hz
     * @param {number} deemphasis_us
     */
    constructor(offset_hz, bandwidth_hz, deemphasis_us) {
        const ret = wasm.wfmdecoder_new(offset_hz, bandwidth_hz, deemphasis_us);
        this.__wbg_ptr = ret;
        WfmDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    pilot_level() {
        const ret = wasm.wfmdecoder_pilot_level(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Uint8Array | number[]} iq
     * @returns {Float32Array}
     */
    process(iq) {
        const ptr0 = passArray8ToWasm0(iq, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wfmdecoder_process(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {boolean} enabled
     */
    set_stereo_enabled(enabled) {
        wasm.wfmdecoder_set_stereo_enabled(this.__wbg_ptr, enabled);
    }
    /**
     * @returns {boolean}
     */
    stereo_locked() {
        const ret = wasm.wfmdecoder_stereo_locked(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) WfmDecoder.prototype[Symbol.dispose] = WfmDecoder.prototype.free;

export class WwvDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WwvDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wwvdecoder_free(ptr, 0);
    }
    /**
     * @param {number} offset_hz
     * @param {number} bandwidth_hz
     */
    constructor(offset_hz, bandwidth_hz) {
        const ret = wasm.wwvdecoder_new(offset_hz, bandwidth_hz);
        this.__wbg_ptr = ret;
        WwvDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array | number[]} iq
     * @returns {Float32Array}
     */
    process(iq) {
        const ptr0 = passArray8ToWasm0(iq, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wwvdecoder_process(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Offline audio entry point for protocol verification / future WAV replay.
     * Centered AM audio at exactly 48 kHz, before volume or de-emphasis.
     * @param {Float32Array | number[]} audio
     */
    process_audio(audio) {
        const ptr0 = passArrayF32ToWasm0(audio, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wwvdecoder_process_audio(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {string}
     */
    status() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wwvdecoder_status(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WwvDecoder.prototype[Symbol.dispose] = WwvDecoder.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./spectrum_dsp_bg.js": import0,
    };
}

const AmDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_amdecoder_free(ptr, 1));
const ArmerTestSourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_armertestsource_free(ptr, 1));
const NfmDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_nfmdecoder_free(ptr, 1));
const OokDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ookdecoder_free(ptr, 1));
const ReceiverFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_receiver_free(ptr, 1));
const WfmDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wfmdecoder_free(ptr, 1));
const WwvDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wwvdecoder_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray16ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 2, 2) >>> 0;
    getUint16ArrayMemory0().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('spectrum_dsp_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
