# Meteor-M LRPT in Spectrum

Select **Decode as… → Meteor-M · LRPT satellite**. The initial tuning is a 137.900 MHz downlink inside a 137.750 MHz, 2.4 MSPS capture. Verify the actual downlink and transmission mode for your pass; the profile names are not a live transmitter-status service. The **Transmission and Doppler settings** section has 137.100 and 137.900 MHz shortcuts, plus editable tuning in Spectrum’s usual decoder-frequency control.

Use your RTL-SDR Blog V4 and existing V-dipole (two approximately 21.5-inch telescoping elements at 120°). Clear sky view and a suitable satellite pass matter. Start with **Connect RTL-SDR**; gain and PPM remain the normal RF controls. The existing receiver supplies all I/Q. Meteor never opens USB or creates another acquisition pipeline. **Try Meteor noise test signal** is an acquisition/performance test, not a synthetic satellite pass, and produces no invented imagery.

## Modes and input

The integration preserves the working `../meteor-m` implementation: digital frequency translation; DC removal and normalization; windowed-sinc antialias filtering and integer decimation; RRC filtering, AGC, symbol timing and carrier recovery; QPSK/OQPSK; convolutional/Viterbi decoding; optional NRZ-M; CCSDS synchronization and derandomization; four-way RS(255,223); packet reassembly; and MSU-MR JPEG Huffman/IDCT strips for APIDs 64–69.

- Modern profiles: **OQPSK, 72 ksym/s, NRZ-M on, interleaving off**. These are configurable, not claims about a satellite’s current operating schedule.
- Legacy Meteor-M2 profile: **QPSK, 72 ksym/s, NRZ-M off**.
- The reference’s 80 ksym/s and interleaver switches remain available and explicitly experimental. There is no validated interleaved 80k recording here.
- Live input is unmodified **CU8 at 2,400,000 complex samples/s**. Meteor’s original front end decimates it by ten to 240 kSPS. Its 180 kHz channel indication is distinct from the tuner capture bandwidth and display span; the preserved FIR has a 95 kHz cutoff.
- Replay supports **CU8**, little-endian **CS16**, and little-endian **CF32**, in raw files or two-channel RIFF WAV. Rates are 180,000–2,400,000 complex samples/s. At 600 kSPS and above, the reference requires integer decimation to its approximately 240 kSPS front end. For example, 187,500, 240,000, 1,200,000 and 2,400,000 are supported. I/Q pairs must be complete; complex-sample block lengths may be arbitrary.

Keep the entire LRPT signal and any frequency adjustment inside the source bandwidth. The carrier’s digital offset is downlink minus recorded/hardware center, plus the selected constant bias and optional Doppler. Tuning adjusts the native mixer without resetting its phase during continuous Doppler updates. Applying receiver or transmission settings deliberately starts fresh decoder state.

## Doppler and orbit information

Live orbital correction is off initially. Enter your observer latitude/longitude/altitude and a matching TLE before enabling it. **Refresh TLE** uses the existing Go API’s optional `GET /api/tle?id=…` proxy to CelesTrak; `npm run api` or the API container must be running. No RadioReference key is needed for this endpoint. The proxy permits only the four supported catalog IDs and caches bounded responses for one hour. Pasted/saved TLEs, orbit prediction and decoding work offline. TLE identity/checksums are validated, and live correction rejects elements more than 14 days old. **Predict passes** retains the reference’s horizon crossings, elevation threshold and sky track.

Frequency bias and residual carrier-search range are separate from orbital correction. The decoder’s internal carrier loop follows residual error. Optional reacquisition resets carrier/timing/AGC and incomplete packet state after a timeout without a validated frame; recovered imagery and counters survive that acquisition retry. A zero timeout disables retries.

## Estimate and automatically correct frequency bias

**Estimate frequency bias** works during live reception or replay. With a recording selected while stopped, the same button starts a normal replay with a one-shot measurement. A reliable result stops the measurement automatically; decoding continues. **Apply estimated bias** updates the active decoder, or fills the frequency-adjustment control for the next replay if that replay has finished. Applying a replay estimate never overwrites live tuning. Live one-shot measurement stops after 60 seconds if no consistent estimate is available; a recording scan may continue until EOF so it can find a stronger part of the pass.

The readout shows the estimate, applied decoder bias, reliable/total windows, fourth-power peak contrast and agreement between measurements. It measures actual baseband after the existing frequency translation/FIR decimator and before RRC, AGC, timing and carrier recovery. It does not infer the bias from the PLL's search frequency. The actual native baseband sample rate determines its FFT frequency scale. The signal must contain enough broad LRPT-like energy; pure tones, silence, narrow signals and unstructured noise are rejected. Peak contrast is an estimator diagnostic, not calibrated RF SNR, and even a good carrier estimate does not establish that the signal contains valid Meteor frames.

**Automatically adjust frequency bias** is enabled by default for continuous live correction. It waits until orbital Doppler correction is configured with a valid TLE and observer location, so it estimates constant bias rather than folding orbital motion into it. For a recording, **Automatically adjust replay bias** also defaults to enabled and starts alongside historical Doppler, the original capture UTC and matching TLE. The main bias control can also toggle automatic mode during an active replay. Existing app preferences migrate once to the enabled default; subsequent opt-outs and explicit opt-outs in imported metadata are retained. Without Doppler removal, manual measurement is still available and explicitly labeled as an offset that includes Doppler; automatic adjustment remains inactive until Doppler information is configured.

The estimator averages sixteen non-overlapping 32,768-point fourth-power FFTs (about 2.18 seconds at 240 kSPS), using the shared FFT implementation. It also measures the ordinary spectrum to reject narrow tones and flat noise. At least three consistent accepted windows are needed for a confident estimate. Automatic changes additionally require a fresh accepted window, stronger peak contrast and tighter agreement. Failed or stale measurements hold the current correction; noise does not trigger a frequency hunt. Search is limited to approximately ±12 kHz around the current setting and all changes must keep LRPT inside the captured band.

Before frame acquisition, a reliable estimate can seed a coarse correction and restart incomplete carrier/timing/packet acquisition. Recovered images and cumulative counters survive. While validated frames are arriving, independent estimates cause at most 100 Hz of adjustment per measurement batch, with a frequency handoff to the fine carrier loop that preserves its phase. A small deadband prevents jitter. Manual application of a large correction may briefly reacquire; it retains existing imagery and counters. Toggling estimation/automatic mode does not recreate the decoder worker or retune the radio.

The UI distinguishes **applied session bias** from the saved manual value. Disabling automatic mode holds the current session correction. Automatic changes stay within the decoder session; **Apply estimated bias** is the explicit way to keep an estimate as manual tuning. Neither mode changes tuner PPM, gain, hardware center, or recorded samples. A new IQ recording snapshots the latest published effective bias and the automatic-mode preference into its optional Meteor metadata. It does not log every adaptive correction; replay can rerun estimation from the original IQ. Saved live and replay manual controls remain independent.

Measurement uses a bounded optional native tap and fixed-size worker FFT buffers. It runs only during a one-shot estimate or when automatic mode is enabled. Turning measurement off frees the native tap and stops FFT work; the bounded last-estimate state remains available until the decoder is disposed. There is no second USB stream or main-thread IQ analysis.

Validation includes both offset signs, QPSK/OQPSK, noise and tone rejection, loss of signal, application/handoff without image or counter reset, one-click file estimation, replay/live preference separation, hot worker controls, mobile layout and offline use. A live-shaped replay of the original 482.07-second recording, using its sample-time clock and starting at zero bias with a ±200 Hz residual search, automatically selected **−2607 Hz** and recovered **1,879 valid frames / 7,259 image strips**, versus 1,891 / 7,295 with the previously known manual recovery profile. It made one correction and held it through the weak end of the pass. The saved manual bias stayed at zero. This validates the live control path with real recorded RF, not a new over-the-air satellite pass.

## Recorded I/Q

Stop the current source, expand **Replay recorded I/Q**, and choose the file. Set raw rate, format, recorded center and nominal downlink, or import matching metadata. WAV supplies its own rate/format. The named public `meteor_m2_72k.wav` regression fixture receives the same explicit legacy preset as in the reference app; arbitrary WAVs are not assumed to be legacy transmissions.

Supported metadata:

- Spectrum’s single-capture **SigMF** sidecar. New Meteor recordings include an optional `spectrum:meteor` extension containing the transmission mode, downlink, observer/TLE, bias and acquisition settings. The normal approximate host timestamp supplies original capture UTC. Older sidecars supply center/rate/format; enter the transmission settings yourself.
- The reference app’s **`meteor-iq-v1`** recording metadata and **`meteor-replay-v1`** recovery profiles, including expected byte counts, seek/duration, historical orbit correction, constant offset and residual acquisition settings.

Replay uses the transmission controls above the file section. Its **frequency adjustment, reacquisition timeout and residual carrier range are separate replay controls**; a blank/default range and zero retry timeout preserve ordinary reference replay behavior. Set start/duration to initialize on a partial pass without reading the preceding samples. Imported byte counts are checked before starting. Use **Reset replay controls** to restore the live profile and remove a previous expected-byte-count constraint when using unrelated captures.

Recorded orbital correction uses the recording’s original UTC plus integer sample position, including the seek offset. It never uses today’s wall time or replay speed. Its TLE must match the satellite and be within 14 days of the capture time. A manually entered constant adjustment does not silently borrow the live bias. Original live settings remain intact after replay.

Data is read sequentially in 65,536-complex-sample blocks with one transferable buffer in flight, never loaded as a whole recording. Replay runs as fast as processing allows. The spectrum/waterfall and timing measurements use the actual source sample rate. Stop interrupts replay and releases its workers; repeat replay starts with fresh native state. On EOF a final drain publishes the remaining image patches and counters. Retuning and changing decoder settings are disabled/rejected until replay stops.

## Diagnostics and imagery

Carrier lock alone is not frame lock. The panel distinguishes acquisition, carrier tracking, and recently validated **ASM + Reed–Solomon frames**. It shows valid/rejected candidates, packets, strips, JPEG rejects, cumulative corrected RS symbols, the latest RS/Viterbi metrics, residual carrier, applied Doppler/digital offset, reacquisition count, buffered soft bits, decoded sample time, native memory and last-block processing time. The shared Signal monitor still reports capture/DSP time and backlog. These are decoder diagnostics, not calibrated RF SNR or an absolute time/frequency reference.

Images grow as validated packets arrive. Choose any received channel, optionally enhance display contrast, choose fit/50%/100%/200%, and scroll or drag to pan. **Raw PNG** always exports the original grayscale pixels, independently of display contrast. Missing strips stay black; zero pixels may also represent genuine darkness. Rejected image packets are counted rather than rendered from uninitialized data. Each channel is capped at 12,000 scan rows; start a fresh session for another pass.

As in the reference, these are six independent grayscale instrument channels. Channel starts can differ. No registered RGB composite, radiometric temperature calibration, map projection or geographical correction is fabricated. The original contrast algorithm ignores missing black pixels when choosing display levels.

## Architecture, limits and validation

`src/dsp/meteor-plugin.ts` lazily instantiates only `src/wasm-meteor/meteor.wasm`. `src/meteor/engine.ts` adapts shared worker input to that existing C core, normalizing directly into a reused native buffer instead of allocating intermediate float IQ. Both live and replay use `capture.worker.ts → decoder.worker.ts → meteorEngine`. Neither path uses a server-side decoder. Owned image patches and constellation samples transfer back through the existing typed event protocol; no output aliases WASM memory.

Each configuration uses a fresh WASM instance because the upstream cores contain static state. Decoder changes terminate the old decoder worker. Sequence gaps detected at the plugin boundary also recreate the decoder and publish a reset event so old channel images cannot leak into the new stream. `dispose()` frees input/channel/demodulator allocations. Browser termination makes the instance and its linear memory eligible for reclamation. USB backlog overflow still stops reception instead of introducing hidden sample gaps.

Native soft-symbol FIFO, 65,536-sample feed calls, 256 MiB maximum WASM memory, six capped image products, bounded image backing storage, and one in-flight replay block prevent unbounded accumulation. The small integration-only C changes enforce the image cap while inserting missing-data padding and add explicit cleanup. They do not replace demodulation, synchronization, FEC, JPEG or pixel-alignment algorithms. View updates are limited by decoded sample time and wall time; unchanged channel tails do not redraw, and React accumulates all transferred patches before coalescing paints. These are patches, not complete growing-image clones.

Regression results from the reference recordings:

| Recording | Frames | Packets | Image strips | Pixel comparison |
| --- | ---: | ---: | ---: | --- |
| Public 187.5 kSPS legacy QPSK | 903 | 3,519 | 3,437 | Exact SHA-256 for APIDs 64/65/68 (1568 × 656/664/656) |
| Local November 20 M2-3, recorded Doppler recovery | 1,891 | 7,467 | 7,295 | Exact SHA-256 for APIDs 64/65/67 (each 1568 × 2400) |

A native C regression also forces repeated large packet-sequence jumps to verify that black padding stays within the image cap (`npm run test:meteor:bounds`, requires a C compiler). Public tests compare both 65,536- and 7,291-sample blocks and verify noise rejection. Independent re-encoding of real payloads tests legacy/NRZ-M transport, QPSK, OQPSK, and CU8 at **1.2 and 2.4 MSPS** with frequency translation and changing Doppler. Synthetic transport is clearly distinguished from a real RF capture. Worker tests cover sequence gaps and source-rate changes. Browser checks cover native worker replay, progressive images, exact pixels, raw PNG/contrast separation, restart/interruption, memory/worker cleanup, source switching, mobile layout and offline operation.

```sh
npm run test:meteor              # Download/check public fixture; core and transport regression
npm run test:browser:meteor      # Serve dev/preview first; actual browser Worker/WASM replay
npm run test:browser:meteor-bias # Estimation/automatic correction and hot controls
METEOR_PRIVATE_TESTS=1 npx vitest run src/meteor/engine.test.ts
METEOR_PRIVATE_TESTS=1 npm run test:browser:meteor
```

The last two commands require the original local capture and profile under the same paths as `../meteor-m`; neither is redistributed. Public fixture provenance is in `fixtures/METEOR.md`. The original implementation/earlier recovery report is retained in [meteor-reference.md](meteor-reference.md).

Build from the included source with Emscripten **4.0.23**:

```sh
EMCC=/path/to/emsdk/upstream/emscripten/emcc npm run build:meteor
```

Normal app and container builds use the checked-in WASM. Source, licenses, exact upstream revisions and local adapter provenance are also served under `/licenses/meteor-provenance.md`.

On this host, headless Chrome replayed the 105.38-second public capture in about **3 seconds**, and the 482.07-second modern recording in about **80 seconds** while other validation was running. The 2.4 MSPS acquisition/noise path used typically **19–35% of each block’s sample-time budget** (brief spikes near 53% under concurrent validation), including capture FFT/telemetry, with no worker backlog or browser errors. These are observed local timings, not minimum-hardware guarantees or measurements of physical USB reception.

A new live satellite pass has not been used to validate this integration. Existing real recordings establish decoder/image equivalence; synthetic 2.4 MSPS and browser timing checks exercise the live-rate software path. They do not verify antenna sensitivity, current satellite modes, USB throughput under every browser workload, or live Doppler reception. The 80k interleaved mode remains unvalidated, as in the reference.
