#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --release --manifest-path wasm/Cargo.toml --locked
node scripts/check-wasm.mjs
node scripts/check-wwv.mjs
node scripts/check-armer.mjs
node scripts/check-nfm.mjs
node scripts/check-ook.mjs
