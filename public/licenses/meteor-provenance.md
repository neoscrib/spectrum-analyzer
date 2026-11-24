# Meteor-M LRPT decoder provenance

Spectrum integrates the working local `meteor-m` browser decoder, inspected and copied November 24, 2026. That reference directory had no committed HEAD at integration time. Its DSP, FEC, packet parser and image reconstruction are retained, with Spectrum-specific worker/input/UI adapters.

Upstream cores by dbdexter-dev, both MIT licensed:

- [meteor_demod](https://github.com/dbdexter-dev/meteor_demod), revision `bf8f6eb14b1abd952c7ec46b4a9b6e64d4d4d885`; [license](meteor_demod.txt).
- [meteor_decode](https://github.com/dbdexter-dev/meteor_decode), revision `e7ca456ea969dc4834b5544c3789de1dd5d2f663`; [license](meteor_decode.txt).

The source retains the reference's verified WASM phase-conversion fix, normalized input scale, modern NRZ-M/frame-lookahead path, ASM/RS validation, bounded packet/JPEG reads, missing-strip handling and acquisition retries. Spectrum additionally caps channel writes (including missing-data padding) at 12,000 scan rows provides explicit channel/demodulator cleanup, exposes an optional pre-demodulation measurement tap, and adds a phase-preserving frequency handoff to the fine carrier loop. The worker implements confidence-gated fourth-power spectral bias estimation using the shared FFT. No simplified replacement DSP or server decoder is used. Interleaved 80k remains experimental.

[Complete native source and build recipe](meteor-source.tar.gz): extract at a directory root, activate **Emscripten 4.0.23**, then run `bash scripts/build-meteor.sh`. It compiles the adapter and vendored C cores to the independently loaded `src/wasm-meteor/meteor.js` / `.wasm`. The archive includes upstream revisions/licenses, the reference implementation notes and Spectrum integration documentation. No private I/Q recordings or observer metadata are distributed in it.

Orbital calculations use [satellite.js](https://github.com/shashwatak/satellite-js) 6.0.1 ([MIT license](satellite-js.txt)); Spectrum reuses the reference app's TLE validation, prediction and Doppler code. No SatDump code or satellite data-service credentials are included. The public legacy test recording is fetched separately and not redistributed with the app; its attribution and checksum are in the repository's `fixtures/METEOR.md`.
