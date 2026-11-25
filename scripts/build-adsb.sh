#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
adsb_build="${ADSB_BUILD_DIR:-$PWD/artifacts/adsb-build}"
mkdir -p "$adsb_build" src/wasm-adsb
printf '%s  %s\n' '2c07280b4816be90c893b229dab6d248cb0453f3ec6cf0465da3fc9726e0a177' 'public/licenses/dump1090-fa-source.tar.gz' | sha256sum --check --status
tar -xzf public/licenses/dump1090-fa-source.tar.gz -C "$adsb_build"
# Only route the demodulator's output to the bounded adapter. Upstream files
# and all fractional-phase slicing / parity algorithms remain unchanged.
sed 's/useModesMessage(/adsb_message(/g' "$adsb_build/dump1090/demod_2400.c" > "$adsb_build/demod.c"
printf 'struct modesMessage; void adsb_message(struct modesMessage *);\n' > "$adsb_build/adapter.h"
core=(mode_s mode_ac crc icao_filter comm_b ais_charset cpr)
sources=(); for file in "${core[@]}"; do sources+=("$adsb_build/dump1090/$file.c"); done
emcc wasm/adsb/bridge.c "$adsb_build/demod.c" "${sources[@]}" -I "$adsb_build/dump1090" -include "$adsb_build/adapter.h" -O3 -flto -Wall -Wextra -Werror -D_GNU_SOURCE --no-entry \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createAdsb -sENVIRONMENT=web,worker,node -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=8388608 -sSTACK_SIZE=1048576 \
 '-sEXPORTED_FUNCTIONS=["_adsb_init","_adsb_process","_adsb_finish","_adsb_take","_adsb_stats","_adsb_cpr","_adsb_frame","_malloc","_free"]' \
 '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8"]' \
 '-sINCOMING_MODULE_JS_API=["wasmBinary","locateFile","print","printErr","onAbort"]' -o src/wasm-adsb/adsb.js
cp wasm/adsb/bridge.c public/licenses/dump1090-bridge.c
cp scripts/build-adsb.sh public/licenses/dump1090-build.sh
