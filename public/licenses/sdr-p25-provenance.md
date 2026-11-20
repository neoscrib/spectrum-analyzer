# Third-party provenance in the `p25` crate

This crate is licensed MIT OR Apache-2.0 (see `LICENSE-MIT`,
`LICENSE-APACHE`). It is written from the published standards —
ANSI/TIA-102 (BAAA, BABA-A, BAAD, BBAB/BBAC/BBAD/BBAE, AAAD, AABC) and
ETSI TS 102 361 — and from measurement of real traffic. This file names
what came from anywhere else, so the notice travels with the code.

## Nothing is ported from another implementation (2026-09-25)

Until 2026-09-25 the IMBE decoder's dequantizer, spectral enhancer,
synthesis and quantization tables were a port of mbelib (ISC), and a
bench example compiled OP25's vocoder (GPL-3) from an external checkout
for an ear A/B. Both left the tree that day:

- `src/imbe/dequant.rs`, `src/mbe/enhance.rs` and `src/imbe/mod.rs` are
  written from TIA-102.BABA-A Chapters 6-8 and §7.1; `src/mbe/synth_std.rs`
  is Chapter 11 (clean-room since 2026-09-13).
- `src/imbe/tables.rs` and `src/mbe/tables.rs` are GENERATED from the
  standard's own pages by `tools/baba_a_tables.py`, like the half-rate
  `src/ambe/tables.rs` before them. `documents/BABA-A-extraction-ledger.md`
  records every page, every invariant and every misprint found.
- The voice-frame interleave and bit modulation in `src/fec.rs` are
  Annex H and §7.4 of the same standard, and the [15,11] Hamming
  generator is transposed at compile time from the gH matrix §7.3 prints.

## Cross-checks, named as such

Other people's code was READ while building parts of this crate, as a
check on our reading of the standard. Nothing was copied from a GPL
source; where an MIT source was transcribed, it is named here.

- **kchmck/p25.rs** (MIT) — the shortened (10,6,3) generator in
  `src/fec.rs` and the Link Control / encryption-sync field layouts in
  `src/frame.rs` were first transcribed from it. Since 2026-09-26 the
  (10,6,3) rows are transposed at compile time from TIA-102.BAAA-B
  Table 4 (identical to the transcription, pinned by a test), and the
  layouts are checked against TIA-102.AABF-D §7.3 and BAAA-B §4.4. Its
  Galois field and Reed-Solomon construction were the cross-check for
  ours.
- **OP25** (GPL-3) — <https://github.com/boatbod/op25> — was consulted as
  a cross-check for the ADP keystream construction (`src/motorola/adp.rs`,
  a Motorola scheme no TIA document describes; the keystream offsets
  are the community's reverse-engineering, ours is written from the
  description and pinned to known-key calls — and where the two
  disagreed, on the bit order of the last vector, 292 keyed calls
  measured the standard's §7.2 ordering right and OP25's wrong), the
  Phase 2 ISCH and scrambler
  details (`src/phase2.rs`) and several Link Control layouts
  (`src/frame.rs`). These are constants the TIA-102 standards define
  and any implementation reproduces the same values. The trellis tables
  (`src/trellis.rs`) are derived at compile time from TIA-102.BAAA-B
  Tables 12/13/14/20; OP25 and kchmck reproduce the same values, as
  correct implementations of the same tables do.

## The Motorola application protocols (`src/motorola/mototrbo.rs`, 2026-09-13)

ARS, LRRP and TMS have no published standard. Their layouts were read
from two independent open implementations and pinned to captured
packets: **SDRTrunk** — <https://github.com/DSheirer/sdrtrunk>
(GPL-3.0), `module/decode/ip/mototrbo/{ars,lrrp,tms}` — for the ARS
header bits and PDU types, the LRRP packet types, token identifiers,
lengths and coordinate scaling, and **TRBO-NET** —
<https://github.com/KD8EYF/TRBO-NET> (KD8EYF's Perl modules) — for the
ARS/TMS framing and its LRRP test packets; the TMS message and
acknowledgement bytes come from **netkiller/Mototrbo**'s captured
packets — <https://github.com/netkiller/Mototrbo>. The two
implementations were used as cross-checks of each other (they agree on
everything the tests pin; SDRTrunk's four-digit TMS header is a
different framing from the one on the wire and was not used), the
captured bytes decided, and the code is written fresh — nothing is
copied from either, so no GPL text is reproduced here. A live system's
own ARS acknowledgements (the audit bed) are the live pin.

## The standard

Everything else is implemented from ANSI/TIA-102 and ETSI TS 102 361 as
published. The IMBE and AMBE+2 vocoders are covered by DVSI patents in
some jurisdictions; nothing in this license grants patent rights beyond
what the Apache-2.0 text provides for our own contributions.
