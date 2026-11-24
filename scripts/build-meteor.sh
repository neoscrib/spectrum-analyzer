#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Emscripten 4.0.23. Set EMCC or activate emsdk before rebuilding.
compiler="${EMCC:-emcc}"
output="${WASM_OUT:-src/wasm-meteor/meteor.js}"
mkdir -p "$(dirname "$output")"
"$compiler" -O3 -DNDEBUG -std=gnu99 -Iwasm/meteor/vendor/meteor_decode -Iwasm/meteor/vendor/meteor_demod \
 wasm/meteor/browser.c wasm/meteor/vendor/meteor_demod/demod.c wasm/meteor/vendor/meteor_demod/dsp/*.c \
 wasm/meteor/vendor/meteor_decode/{decode,channel,utils}.c \
 wasm/meteor/vendor/meteor_decode/{correlator,deinterleave,diffcode,ecc,jpeg,math,parser,protocol}/*.c \
 -lm -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456 \
 -sEXPORTED_FUNCTIONS='["_malloc","_free","_browser_init","_browser_close","_browser_feed","_browser_tune","_browser_stat","_browser_carrier","_browser_pixels","_browser_height","_browser_constellation","_browser_last_cadu","_browser_feed_soft","_browser_reacquire_after","_browser_carrier_limit","_browser_bias_enable","_browser_bias_iq","_browser_bias_count","_browser_bias_rate","_browser_bias_tune"]' \
 -sEXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPF32"]' -o "$output"
