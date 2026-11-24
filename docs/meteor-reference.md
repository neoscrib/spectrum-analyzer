# Decoder implementation and validation

The browser uses **meteor_demod** and **meteor_decode**, both MIT licensed by
dbdexter-dev. Exact source revisions and upstream URLs are in each vendored
`UPSTREAM` file. License texts accompany both the source and browser WASM.
No P25 decoder or audio/vocoder code is used.

## Why this port

[SatDump](https://github.com/SatDump/SatDump) is the most useful current reference.
Its [Meteor pipeline](https://github.com/SatDump/SatDump/blob/master/resources/pipelines/Meteor-M.json)
separates legacy QPSK from modern OQPSK + convolutional decoding + NRZ-M + CCSDS
randomization + four-way RS(255,223). Its Meteor instrument reader handles six
MSU-MR APIDs. A complete browser port also brings a C++ DSP graph, native I/O,
threading, plugins, filesystem/product infrastructure, image/calibration and
projection dependencies. That is significantly more work than compiling the
small C cores. SatDump is GPL-3.0; a direct port would require preserving that
license and supplying corresponding source. No SatDump code is included here.

The smaller C cores implement actual RRC filtering, AGC, symbol timing, carrier
recovery, convolutional/Viterbi error correction, derandomization, Reed–Solomon,
packet reassembly and JPEG Huffman/IDCT reconstruction. The Worker loads a real
compiled WASM module. There is no native decoding process or decoding server.

## Local changes (2026-11-19)

- `wasm/browser.c`: a bounded streaming FIFO, digital frequency translation,
  windowed-sinc antialias FIR/integer decimation, modern NRZ-M transport path,
  packet-to-channel adapter and measured diagnostic accessors.
- Modern frames use one rotation through the frame **and its lookahead**, then
  frame-local Viterbi decoding, NRZ-M, derandomization and RS. Rotating successive
  frames independently through a continuous trellis corrupted frame tails;
  regression tests exercise alternating differential states.
- `meteor_demod/dsp/sincos.c`: cast floating-point phase to int32 before narrowing
  to int16. Direct out-of-range float-to-int16 conversion had undefined behavior
  and produced different results under WASM. This prevented carrier recovery.
- Input normalization uses 1024 internal units per normalized full scale. The
  original AGC loop becomes unstable for high-amplitude int16-scaled USB data.
- `meteor_decode/decode.c`: reserve an entire worst-case frame before pull reads;
  verify the CCSDS attached sync marker as well as RS (zero codewords alone can
  pass RS); expose frame counters. NRZ-M is applied after convolutional decoding.
- `parser/mpdu_parser.c`: bound packet payload copies before reassembly.
- `jpeg/huffman.c`: bounded reads, validate Huffman codes/runs and truncation;
  never display uninitialized strips. `channel.c`: zero missing initial pixels.
- Disambiguate the projects' `utils.h` includes. Fix overlapping deinterleaver
  cache copies. Interleaved 80k remains experimental and is **not validated**.

Each receiver/replay uses a fresh Worker and WASM instance so all upstream static
DSP state starts clean. Images use at most about 12,000 scan rows per channel;
missing strips stay black. Native upstream command-line executables are not used
by the app. Their original source is retained for provenance, but the build script
compiles only the relevant cores and browser adapter.

## Real capture result

The separately downloaded [TU Berlin project recording](https://github.com/lar-tech/satellite-decoder)
is a **legacy 72k QPSK** recording, not a confirmed modern M2-3/M2-4 capture.
It is 105.381888 seconds of stereo PCM16 IQ at 187,500 complex samples/s.
Recording date, hardware and RF center are not specified in its WAV header.
Do not infer the satellite's present transmitter status from this recording.

SHA-256: `c8be339e69db2b192f852c8ab5d2cb7c7b547552bab41fadd584e0296df0cdf8`

The shipped WASM produces:

| Measurement | Result |
|---|---:|
| ASM + Reed–Solomon-valid frames | 903 |
| Rejected frame candidates | 17 |
| Reassembled packets | 3,519 |
| Decoded image strips | 3,437 |
| JPEG strip rejects | 0 |
| APID 64 / channel 1 | 1568 × 656 |
| APID 65 / channel 2 | 1568 × 664 |
| APID 68 / channel 5 | 1568 × 656 |

Vitest checks exact pixel hashes and equal results with both 65,536-sample and
7,291-sample input blocks. Noise and silence tests must yield zero frames,
packets and images. The streaming decoder deliberately retains less than
about 0.3 seconds of symbols as lookahead; it does not fabricate a padded tail.

`check-modern.mjs` extracts real RS-corrected payloads and independently
re-encodes them into synthetic test transport. It tests legacy soft symbols,
modern NRZ-M soft symbols, QPSK IQ, OQPSK IQ, and CU8-quantized 1.2 MS/s IQ with
FIR decimation and a changing carrier/Doppler offset. These tests confirm software
paths and carry actual decoded payloads, but **are not real modern RF captures**.

Headless Chrome tests exercise the actual browser Worker/WASM path, progressive
channel canvases, PNG download, TLE refresh, restoration of live settings after
replay, and mobile overflow. USB lifecycle/gain/error behavior uses mocked driver
objects; this is not a hardware test.

## Remaining hardware and mode validation

- The user reported 12 live validated frames from the first M2-3 pass; live
  imagery was not confirmed in the browser during that pass.
- Modern 72k is now also validated against that real local IQ capture; see below.
- Interleaved 80k has upstream algorithm support but no validated capture or
  end-to-end regression here. The UI explicitly marks it experimental.
- No physical antenna sensitivity, preamp overload, tuner calibration, USB
  throughput or live Doppler performance has been verified in this project.
- Exported images are raw grayscale. They are not calibrated temperature,
  georeferenced maps or color composites. Channel first rows can differ; do not
  assume cross-channel registration for composites.

## First real local M2-3 capture (November 19, 2026)

The user supplied a 1,247,805,440-byte CU8 recording at 1.2 MS/s, spanning about
8 minutes 40 seconds from 8:04:35 to 8:13:15 PM CST. Raw file SHA-256:
`d38e7e5e843f6e85862b2805795ad598acddfc1c2c3dd0ed4075e0c2027d22b2`.
The separately saved JSON metadata includes actual center frequency, start time,
TLE, observer and gain-change offsets. The raw file is private/local and is not
redistributed or required by the public fixture tests.

Measured spectra show an intermittent wide signal around 137.9 MHz. Its strongest
sampled relative in-band contrast was about 4.8 dB at 8:09:50 PM CST, with tuner
gain 49.6 dB. This contrast compares median spectral-bin power against adjacent
background; it is **not calibrated SNR**. No endpoint/rail hits were found in the
sampled 54.6 ms windows taken every half-second. This does not rule out tuner or
upstream overload. Gain changes and fading prevent a universal gain conclusion.

A repeatable decode of capture seconds 280–330, with a -6 kHz digital tuning
adjustment and no predicted Doppler, recovers **160 ASM + RS-valid frames,
633 packets, 619 image strips**, and APIDs **64, 65, 67**. Each channel is
1568 × 128. Received frame counters progress from 1588717 to 1588888; gaps are
consistent with lost packets. All three images have exact hashes in the local
`artifacts/first-live-pass/decode-report.json`. The reconstructed infrared
channel has visible scene texture; channels 1 and 2 are predominantly dark.
Black missing-data strips are preserved. Contrast previews stretch only received
nonzero pixels and are labeled separately from raw PNG/PGM exports.

A full-file decode can fail to acquire even when this shorter initialized run
recovers packets. The -6 kHz adjustment is a successful acquisition hypothesis,
not a measurement of transmitter or tuner error. Do not apply it as universal
PPM calibration. Browser live reception reported 12 frames; the 160-frame result
is **offline recovery**, not a claim that the browser displayed those images live.

Use `scripts/analyze-capture.mjs` with the original file and metadata. For a
repeatable local regression, add `--start 280 --seconds 50 --offset-hz -6000
--minimum-frames 160 --minimum-strips 619`. A failed minimum exits nonzero.
The real capture also exposed a Viterbi adapter scratch-buffer bug: the throwaway
output must be `VITERBI_DELAY` bytes (8), not 4. The adapter now derives scratch
size, decode count and lookahead from that constant. Legacy pixel hashes and
modern transport tests are required to continue passing.

Browser replay now accepts a start time, duration and frequency adjustment, and
can import the CLI's `meteor-replay-v1` recovery settings. Headless Chrome has
reproduced the real local 160-frame/619-strip result, including exact image pixel
hashes for APIDs 64,65,67. The full-file nominal replay result is not equivalent
to this fresh 280-second start. Display contrast is optional and never changes
the raw PNG export. The browser recovery check verifies that distinction.

## November 20 morning capture: dynamic Doppler

The second supplied M2-3 CU8 capture contains 1,156,972,544 bytes at 1.2 MS/s,
482.071893 seconds. Its matching metadata records **15:57:20.118 UTC** as the
sample start (the filename timestamp precedes it), center 137.750 MHz, nominal
downlink 137.900 MHz, OQPSK/72k/NRZ-M, and gain 49.6 dB throughout. Original IQ
and observer metadata remain local. These results concern that recording;
they do not verify another live pass or hardware calibration.

The analysis has two independent parts:

- 32 independently initialized 30-second windows, spaced 15 seconds apart
  (the last truncated), sweep nine fixed offsets from −8 to +8 kHz. Each score
  counts actual ASM + RS-valid frames. Acquisition seeds jump between offsets;
  their maximum is **not** a direct physical carrier measurement. Zero-frame
  windows have no reported best offset.
- Fourth-power spectral estimates, retaining only peak/median contrast ≥8 dB,
  produce 13 high-confidence carrier points. Their drift follows the saved
  orbital Doppler plus a fitted constant **−2607.28 Hz** bias, with **10.97 Hz
  RMS** residual and 23.38 Hz maximum absolute residual. Predicted Doppler changes
  from about +3.00 kHz to −2.76 kHz. This supports orbital correction plus a
  separate bias; it does not identify which oscillator/transmitter caused it.

The plot is in local `artifacts/nov20-sweep/offset-versus-time.png`, with the
underlying window results, CSV, carrier estimates and trajectory summary beside
it. The cache contains translated/filtered/decimated actual samples only. Final
decoding uses the original full-rate CU8. Relative band contrast is not SNR;
deep fades remain in several intervals. The recording does not establish that
every missing strip is recoverable.

Original-core continuous full-file comparisons recovered zero frames at fixed
0 Hz or −6000 Hz, versus **986 frames / 3791 strips** with recorded orbital
correction alone. Recovery also depends on carrier/timing acquisition after
fades; simply adding a constant offset does not reliably improve it.

The updated core adds an optional timeout without validated frames, resetting
the AGC, RRC/timing and carrier acquisition while preserving NCO phase, images
and counters. Only incomplete symbol/packet state is discarded. Reset routines
explicitly clear upstream static indices and scan direction. A configurable
residual carrier range prevents searching far away from the supplied trajectory.
No outer feedback loop competes with the internal carrier loop.

Recorded replay and the CLI share `createReplayTuning`: capture UTC plus integer
source-sample offset, including seek. Current wall time and playback speed do
not enter the calculation. TLE freshness is checked against capture time.
Predicted correction is rounded to 0.01 Hz, far below orbital uncertainty, to
give the browser and Node identical NCO commands despite tiny JS-engine math
differences. Marginal acquisition can amplify those otherwise tiny differences.
Each IQ block updates frequency without resetting the NCO phase.

With recorded Doppler, −2607 Hz constant bias, ±200 Hz residual search and a
1-second reacquisition timeout, a single continuous run recovers **1891 valid
frames, 7467 packets and 7295 image strips**, without manual retuning. APIDs
64,65,67 are each **1568 × 2400**. Local `artifacts/nov20-recovered/` holds the
report, hashes, raw PGMs/PNGs, contrast previews and importable replay settings.
These settings are selected for this recording, not universal tuner defaults.
Raw images retain black missing strips; contrast previews are labeled.

Vitest covers capture/seek time, missing/stale/wrong-satellite orbit metadata,
fixed-offset compatibility, separate live/replay bias and noise rejection with
reacquisition. Public legacy pixel hashes and modern transport tests still pass.
Browser recovery validation additionally compares exact counts and all channel
pixel hashes, then checks that display enhancement preserves raw PNG values.
