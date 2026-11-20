#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --manifest-path wasm/Cargo.toml --release --target wasm32-unknown-unknown --locked
wasm-bindgen wasm/target/wasm32-unknown-unknown/release/spectrum_dsp.wasm --target web --out-dir src/wasm --out-name spectrum_dsp
