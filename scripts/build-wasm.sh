#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
for decoder in core wfm am wwv nfm ook armer; do
  name="$decoder"
  if [[ "$decoder" == core ]]; then name=dsp_core; fi
  cargo build --manifest-path wasm/Cargo.toml --release --target wasm32-unknown-unknown --locked --no-default-features --features "$decoder"
  wasm-bindgen wasm/target/wasm32-unknown-unknown/release/spectrum_dsp.wasm --target web --out-dir src/wasm --out-name "$name"
done
