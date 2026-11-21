#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Requires emsdk 7.0.0 and CMake 3.x on PATH. No host SDR/network libraries.
rtl_build="${RTL433_BUILD_DIR:-$PWD/artifacts/rtl433-build}"
mkdir -p "$rtl_build"
printf '%s  %s\n' '168e2052dfb9d9ffc6bc7d8581ad4757dac53b78f57b3dec76c447c7ae3880c5' 'public/licenses/rtl_433-25.12-source.tar.gz' | sha256sum --check --status
if [ ! -f "$rtl_build/rtl_433/CMakeLists.txt" ]; then
  tar -xzf public/licenses/rtl_433-25.12-source.tar.gz -C "$rtl_build"
fi
# Fixed-size upstream scratch buffers need only cover our bounded 65536-sample calls.
python3 - "$rtl_build/rtl_433/include/rtl_433.h" <<'PY'
import sys
p=sys.argv[1];s=open(p).read().replace('#define MAXIMAL_BUF_LENGTH      (256 * 16384)', '#define MAXIMAL_BUF_LENGTH      (65536)');open(p,'w').write(s)
PY
emcmake cmake -S "$rtl_build/rtl_433" -B "$rtl_build/cmake" -DENABLE_RTLSDR=OFF -DENABLE_SOAPYSDR=OFF -DENABLE_OPENSSL=OFF -DENABLE_THREADS=OFF -DENABLE_IPV6=OFF -DBUILD_TESTING=OFF -DCMAKE_C_FLAGS='-O3 -flto'
cmake --build "$rtl_build/cmake" --target r_433 -j 4
emcc wasm/rtl433/bridge.c "$rtl_build/cmake/src/libr_433.a" -I "$rtl_build/rtl_433/include" -I "$rtl_build/rtl_433/src" -O3 -flto -D_GNU_SOURCE --no-entry \
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createRtl433 -sENVIRONMENT=web,worker -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16777216 -sMAXIMUM_MEMORY=134217728 -sSTACK_SIZE=2097152 \
 '-sEXPORTED_FUNCTIONS=["_rtl_init","_rtl_process","_rtl_free","_rtl_protocols","_rtl_stats","_malloc","_free"]' \
 '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8"]' \
 '-sINCOMING_MODULE_JS_API=["wasmBinary","locateFile","print","printErr","onAbort"]' -o src/wasm-rtl433/rtl433.js
# Corresponding adapter and complete build recipe are served beside source/license.
cp wasm/rtl433/bridge.c public/licenses/rtl_433-bridge.c
cp scripts/build-rtl433.sh public/licenses/rtl_433-build.sh
