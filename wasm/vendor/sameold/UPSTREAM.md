# Vendored sameold 0.6.0

Source: crates.io `sameold` 0.6.0, MIT OR Apache-2.0.
Upstream: https://github.com/cbs228/sameold
Original crate source copied from the Cargo registry; Cargo.toml dependency
versions and source otherwise retain the upstream release.

Local conformance fix in `src/receiver/framing.rs`: mask the permitted eighth
padding bit before ASCII prefix/framing checks. 47 CFR 11.31(a)(1) permits
either value; upstream assumes it is always zero and rejects otherwise valid
headers with high padding bits. Preamble correlation is unchanged.

The application wrapper supplies normalized-audio AGC initialization and a
bounded six-second frame timeout; these are outside the vendored library.
Project WASM tests independently generate and decode both padding values.
