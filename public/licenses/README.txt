Third-party runtime dependencies

@jtarrio/webrtlsdr 3.0.7 — Apache-2.0
https://github.com/jtarrio/webrtlsdr
License: webrtlsdr.txt

React / React DOM 19.3.1 — MIT
https://github.com/facebook/react
License: react.txt

lucide-react 1.76.0 — ISC
https://github.com/lucide-icons/lucide
License: lucide.txt

DM Sans and IBM Plex Mono — SIL Open Font License 1.1
Licenses: dm-sans.txt and ibm-plex-mono.txt

wasm-bindgen 0.2.130 — MIT OR Apache-2.0
https://github.com/wasm-bindgen/wasm-bindgen
License: wasm-bindgen-MIT.txt and wasm-bindgen-Apache.txt

The WebUSB lifecycle and FFT infrastructure was adapted from the user's local
armer/web and meteor-m projects. The Rust WFM decoder is original to this project.

WWV JSON serialization runtime dependencies (MIT license selected where dual-licensed):
serde / serde_core 1.0.229 — MIT OR Apache-2.0
serde_json 1.0.154 — MIT OR Apache-2.0
itoa 1.0.19 — MIT OR Apache-2.0
memchr 2.8.3 — MIT OR Unlicense
zmij 1.0.23 — MIT
Their MIT license texts are included by package/version in this directory.

WWV format references: NIST's published WWV/WWVH time-code diagram and broadcast
description. The decoder is original Rust code; no NTP/GNU Radio code is bundled.

ARMER P25 Phase I decoder adapted from the user-provided armer/web project.
sdr-p25 0.1.0, sdr-fec 0.1.0, sdr-stream 1.9.0 — MIT OR Apache-2.0
libm 0.2.16 — MIT
MIT texts selected and included by package/version. sdr-p25 provenance included.
@xmldom/xmldom 0.9.12 — MIT (local server SOAP parsing only).
SDRTrunk source was used to verify playlist interchange; its code is not bundled.

The NFM demodulator, carrier/noise squelch, CTCSS detector and DCS detector
are original Rust implementations. Signalling parameters and independent DCS
word test vectors follow ETSI TS 103 236 V1.1.1 (2014-01); no third-party
CTCSS/DCS implementation code is bundled. Frequency banks cite FCC, NWS, ARRL
and USCG channel references in the UI and README.

The OOK/binary ASK envelope and pulse decoder is original Rust code. Its .ook
export follows rtl_433's documented text interchange format.

rtl_433 25.12 — GPL-2.0-or-later, compiled separately with Emscripten 7.0.0.
https://github.com/merbanan/rtl_433
Complete bundled source, embedding adapter, build recipe and license details:
rtl_433-NOTICE.txt, rtl_433-25.12-source.tar.gz, rtl_433-bridge.c,
rtl_433-build.sh, rtl_433-COPYING.txt.
