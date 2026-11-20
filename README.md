# Spectrum

A browser-based RTL-SDR spectrum analyzer with a WebUSB receiver and Rust/WebAssembly WFM stereo, AM, WWV time-code, and ARMER P25 Phase I decoders. React, TypeScript, and Vite; reception and decoding run locally. RadioReference alias lookup is an optional network service.

```sh
npm ci
npm run dev
```

Open **http://localhost:5176** in Chrome or Edge on the computer with your RTL-SDR. The development and preview servers bind to loopback. Port 5176 avoids the reference apps. Generated WASM is included; normal use requires Node/npm, not Rust.

## Receive and decode

1. Close other applications using the dongle. Click **Connect RTL-SDR** and select the receiver in Chrome's USB chooser. Supported WebUSB IDs are Realtek `0bda:2832` and `0bda:2838`, with R820T/R828D-family tuners.
2. Enter a **center frequency** in MHz and press **Tune**. This changes the hardware frequency. Retuning preserves the decoder's offset for WFM/AM/WWV. ARMER keeps its absolute control frequency fixed while you reposition the capture.
3. Set **display span** from 25 kHz to 2.4 MHz. This crops the spectrum around the center; the hardware continues capturing at **2.4 MSPS**. Zooming does not change decoder tuning or its channel filter. Spans wider than the captured band are intentionally unavailable; there is no sweep mode.
4. Select **Decode as… → WFM**, then click a station on the spectrum or enter its **decoder frequency** and press **Set**. The decoder independently mixes and filters that channel from the captured IQ. Its entire channel must fit inside the capture. Keyboard users can focus the spectrum and use left/right arrows (10 kHz; Shift for 100 kHz).
5. Click **Play audio**. WFM outputs **stereo, 48 kHz PCM**, with a 15 kHz audio low-pass per channel and selectable 75 µs, 50 µs, or no de-emphasis. **Auto stereo** recovers the broadcast’s 19 kHz pilot and 38 kHz difference channel. The output indicator reports **Stereo · pilot locked** after acquisition. Without a stable pilot it smoothly falls back to mono; choose **Mono** to force mono output on noisy stations. RDS is not implemented.

**Channel width** is the digital WFM filter width, independently selectable from 150–220 kHz. **Tuner gain** and **frequency correction** apply with the RF settings button while connected. Connecting uses the currently displayed RF draft values. The RF panel explicitly shows the applied/saved values and flags pending changes, so a slider draft cannot be mistaken for a hardware setting. The driver rounds manual gain to a supported hardware step. Bias tee stays off. Stop releases the USB interface; reconnect reuses the selected receiver. After a disconnect/error, the next connection opens the chooser again.

Use **Try FM test signal** to run generated CU8 IQ through the exact same FFT, WASM decoder, and AudioWorklet. The source is clearly labeled, resets tuning to 100.0000 MHz / 100.1000 MHz, and produces a stereo multiplex with **1 kHz on the left, 2 kHz on the right**, a 19 kHz pilot, and two neighboring test carriers. It never accesses the receiver. Gain and PPM have no effect on this generated source.

The spectrum is an 8,192-point Hann-windowed FFT (293 Hz/bin at 2.4 MSPS). Display zoom does not increase FFT resolution. Trace smoothing, peak hold, display floor, waterfall, and PNG export are available. **Freeze view** leaves acquisition and audio running. Power is relative **dBFS**, not calibrated dBm or SNR. Input power includes the full captured band; ADC clipping counts samples at the converter limits. DSP processing is time spent processing one block divided by that block's RF duration, not total machine CPU usage.

Settings persist in browser-local storage. IQ/audio are processed locally and are not uploaded. Capture recording/replay, other modulation modes, RDS, and arbitrary-rate tuners remain future extensions.

## AM audio

Select **Decode as… → AM · amplitude modulation**, tune the desired channel, and click **Play audio**. Selecting AM preserves your hardware center and decoder frequency. Channel widths are **6, 8, 10, 12, or 16 kHz** (10 kHz default), independent of the display span and 2.4 MSPS capture. Output is 48 kHz mono, duplicated to both speakers. The AM envelope detector normalizes slowly against the carrier to compensate for RF level changes. Playback adds a 20 Hz DC blocker and a short muted startup; WWV time-code processing receives the original normalized AM before that playback filter. FM stereo and de-emphasis controls do not apply to AM.

The current tuner path remains 24–1766 MHz; selecting AM does not add lower-frequency reception. **Try AM test signal** generates a 1 kHz AM station at **120.100 MHz**, with a neighboring 3 kHz AM station at **120.140 MHz**, captured around 120.000 MHz. This is explicitly labeled synthetic data and uses the actual WASM and AudioWorklet. Select the neighboring carrier to hear its different tone.

`wasm/src/am.rs` supplies a shared AM channelizer/envelope detector. Standalone `AmDecoder` emits only audio; `WwvDecoder` uses the identical demodulator and additionally feeds its 100 Hz protocol decoder. Rust tests verify both tuning-offset signs, adjacent-channel rejection, channel-width filtering, mono output, and arbitrary IQ chunk boundaries. Browser tests measure rendered audio, select the neighboring station, retune across the center, and check volume/pause/stop and responsive layout.

## ARMER / P25 Phase I

Select **Decode as… → ARMER · P25 Phase I**. This reuses the C4FM trunking and IMBE pipeline from `../armer/web`, compiled into the shared WASM module with `sdr-p25` 0.1.0. The starting site is **Ogilvie 5-75**, control **853.075 MHz**, captured around **852.400 MHz**. The saved alternate **853.875 MHz** can be selected manually; automatic control-channel rotation is not implemented. You can enter another control frequency, adjust the hardware center, and save that frequency. Display span only zooms the FFT; voice following uses the full 2.4 MHz capture.

Connect the receiver and press **Play audio**. The decoder learns broadcast channel plans, reports CRC-validated system/WACN/NAC/RFSS/site data, follows one enabled clear voice call inside the capture, and converts 8 kHz IMBE PCM to 48 kHz mono in both speakers. All nonzero talkgroup IDs, including unknown IDs, listen by default with equal priority. An already selected call is not preempted merely because another ID is numerically smaller. Out-of-band grants remain visible in recent calls; this version does not retune away from the control channel to follow them. **CQPSK/LSM simulcast, Phase II voice, and encrypted audio are not supported.** Unknown encryption state is withheld until confirmed clear. Listen toggles apply to the actual transmitted group ID; a patched member does not override a muted group.

The **Talkgroups & calls** panel starts with 15 named aliases from your reference playlist, all enabled regardless of that playlist's original priorities. Discovered IDs appear automatically. Search, assign names/groups, add IDs, toggle individual entries, choose whether unlisted IDs listen, or use **Listen all / Mute all**. Configuration persists in browser-local storage. Live observations are bounded to 2,000 IDs, recent call history to 60 events. Generated observations are kept separate and never saved as received traffic. Name edits do not reset synchronization; policy changes discard queued old-policy audio while retaining control state.

**Export SDRTrunk XML** writes a new version-4 playlist containing the current/saved control frequencies, alias names/groups, and listen policy (`priority=-1` for muted IDs, `100` otherwise). Non-overlapping ranges cover otherwise unlisted IDs so the default policy survives interchange. **Import SDRTrunk XML** accepts version 3/4 playlists, lets you select a supported Phase I C4FM tuner channel, and imports aliases, ranges, and explicit mute settings. It does not import SDRTrunk's call-ranking priorities, recordings, or unrelated protocols. Original files are never modified. Export was also verified using SDRTrunk 1.0.0's actual Java playlist parser.

Control demodulation and CRC candidate selection match the Fieldglass reference receiver in `../armer/web`. `npm run test:fieldglass` compares the actual built WASM modules using identical clean/noisy CU8 at center frequencies **852.400 MHz** and **853.850 MHz**, with a **853.075 MHz** control channel. It requires identical counters and protocol events, including corrections and timestamps. The optional capture comparison also exercises small/USB-sized chunks. The panel reports **recent valid blocks/second and candidate rejection percentage over approximately five seconds of RF stream time**, alongside session totals. Candidate rejection is neither BER nor the percentage of all transmitted packets lost.

USB reads are continuously replenished: each completed transfer is replaced before its IQ is dispatched, without waiting for the other transfer to complete. Results remain in request order. Hardware configuration temporarily drains the remaining reads, applies tuning/gain, resets the endpoint and decoder, and resumes. Stop drains outstanding transfers before releasing USB. Tests cover immediate refill, ordered delivery, tuning boundaries, overload, and unplugging. These transport behaviors are covered by automated tests; live reception was subsequently confirmed by the user as described below.

**Alias directory → RadioReference** optionally retrieves ARMER system 3508 aliases. RadioReference's [official API requirements](https://support.radioreference.com/hc/en-us/articles/18844460198932-Database-Web-Service-API) require an approved developer application key and a Premium account. Set `RR_APP_KEY` in `.env.local` (see `.env.example`), restart `npm run dev` or `npm run preview`, and reload. Enter your RadioReference username/password in the panel. The application key stays on the local server; credentials travel over HTTPS to RadioReference, are cleared after each request, and are not persisted. Returned aliases preserve custom/imported names and listen choices. SOAP parsing and the browser flow are tested with mocked responses; **authenticated upstream lookup has not been verified without credentials**. Static-only hosting needs a compatible local API server to enable this optional lookup. Manual aliases and playlist import/export work offline.

**Try ARMER test signal** creates CU8 C4FM IQ containing CRC-valid control/site/network messages, two clear groups, an encrypted grant, and an out-of-band grant. It runs through the real WASM demodulator/FEC/IMBE decoder and AudioWorklet. Its vocoder frames are test data, not intelligible speech or received traffic. Tests verify only clear enabled groups produce PCM, muted groups still appear in control events, and the exported XML round-trips the full 1–65535 policy. The 20-second RF recording from the reference project produces **41 valid / 133 rejected control candidates in both built decoders**, with identical protocol events: system **40F**, WACN **BEE07**, RFSS/site **5/75**, NAC **40C**. This old recording contains poor RF and is not a measurement of current live reception. It has no usable voice grants. Clean generated IQ at both tested center frequencies produces **46 valid / 0 rejected** over 1.25 seconds in each decoder. **Live ARMER reception and audible voice playback were confirmed by the user on November 20, 2026**, after the transport and Fieldglass-parity changes. The working settings were center **853.850 MHz**, control **853.075 MHz**, manual gain **22.9 dB**, and **0 PPM**. Reported counters were **4,447 valid / 7 rejected** (approximately **0.16%** rejected overall), with **40.0 valid blocks/s** and **0.0% rejected** in the latest five-second window. This confirms the live WebUSB → WASM P25/IMBE → browser audio path; it does not establish which individual change accounted for the improvement.

## WWV at 25 MHz

Select **Decode as… → WWV · NIST time code**. The default preset sets the hardware center to **25.050 MHz**, decoder to **25.000 MHz**, display span to **150 kHz**, and channel width to **10 kHz**. The 50 kHz hardware offset keeps the carrier away from the RTL-SDR's DC notch; it does not change the station's actual frequency. Click **Connect RTL-SDR**, then **Play audio** to hear AM ticks, tones, and announcements while the 100 Hz code decodes independently.

The digital panel displays the measured pulse duration, binary zero/one/position markers, 60-second frame, UTC date/hour/minute, day of year, DUT1, raw DST indicators, leap-second warning, and valid/rejected frame counts. It follows [NIST's digital time-code diagram and broadcast description](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code). The code starts 30 ms after each second: approximately 170 ms for zero, 470 ms for one, 770 ms for a position marker. Second zero has no 100 Hz pulse. The decoder identifies that reference gap, validates position/reserved bits and BCD/calendar ranges, then requires **two consecutive frames advancing exactly one minute** before reporting confirmation. The code has no checksum.

Allow up to about **two minutes for the first complete candidate and three for confirmation** from an arbitrary start. The timestamp is the **start of the decoded minute frame**, received near the end of that minute. It is not an extrapolated live clock. No computer time, network time, or operating-system clock changes are involved. No absolute timing/propagation calibration is claimed. The century is assumed to be 2000–2099 because the broadcast supplies two year digits. Positive/negative leap-second minute handling and deep-fade combining are not implemented; malformed frames or cadence loss cause reacquisition. DST bits are displayed without applying a local-time interpretation.

NIST's [25 MHz WWV broadcast](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv) is experimental and can be interrupted. The disabled 2.5/5/10/15/20 MHz presets are below this tuner's current 24 MHz minimum and require appropriate HF hardware or an upconverter. AM audio or a carrier alone does not establish that WWV was received. Strong broadcast-FM mixer images can still appear in the RF capture; the WWV channel filter and time-code validation are separate from the spectrum display.

**Try WWV test signal** generates a fixed, explicitly labeled 2026-11-20 test transmission in CU8 IQ. Its default **16×** mode exercises the same WASM channelizer/AM demodulator/pulse/frame decoder at accelerated stream time, with audio muted. Choose **1×** to hear generated AM audio. The source begins at second 58 of 12:33 UTC: the first complete candidate is 12:34, then 12:35 confirms it. Actual speed is CPU-limited. Synthetic provenance remains visible after stopping so a test timestamp cannot be mistaken for RF reception.

Validated: the full generated IQ path confirms the expected UTC/date/DUT1 in Chrome, AM audio plays at 1×, corrupt position markers are rejected, and noise or an unpulsed 100 Hz tone does not create a timestamp. The actual WASM also passes NIST's published example (2001/day173/21:10/+0.3), arbitrary starting phase, stream boundaries, loss of synchronization, and WFM regression checks. **Live over-the-air WWV reception has not yet been verified.**

The shared Rust `Downconverter`/FIR primitives serve WFM, AM, and WWV; AM and WWV additionally share the envelope detector in `wasm/src/am.rs`. WWV uses two-stage complex filtering/decimation (2.4 MSPS → 240 kHz → 48 kHz), envelope AM detection with slow carrier normalization, then quadrature 100 Hz recovery and pulse/frame validation. Its offline `process_audio()` entry accepts centered AM audio at 48 kHz for protocol tests; it does not bypass IQ processing in the app's generated-source/browser test.

## Linux USB access

If the DVB TV driver owns the USB interface, close SDR software, then run:

```sh
bash scripts/prepare-usb.sh
```

This helper temporarily unbinds only `dvb_usb_rtl28xxu` interfaces on matching Realtek receivers, using sudo. It does not blacklist a driver or install persistent configuration. Replugging may let the TV driver reclaim the device. Normal app startup does not run this helper or change permissions. Your account also needs access to the USB device (usually a distribution RTL-SDR udev rule).

## Architecture and adding a decoder

- `src/radio.ts`: WebUSB lifecycle, two continuously replenished reads, ordered configuration after draining pending transfers, and a bounded worker queue. Overload stops reception explicitly instead of silently dropping IQ continuity. Configuration revisions discard old queued results.
- `src/decoders.ts`: discoverable manifests declaring bandwidth, sample-rate requirements and typed output capabilities, plus hardware compatibility checks. Current WASM pipelines require exactly 2.4 MSPS CU8 input.
- `src/dsp/plugins.ts`: worker-owned decoder instances with `process()` and `dispose()`. Configuration creates a fresh instance. Each returns a list of typed events; audio is optional. `src/types.ts` declares audio, protocol telemetry, time-code, and synchronization events. Audio specifies 48 kHz interleaved stereo, source sample position, and transfer ownership. AM emits audio alone; WWV emits AM audio and structured time-code/status; WFM emits stereo audio and pilot telemetry. ARMER emits audio, control/call messages, and receiver telemetry, with a live policy-update method that retains control synchronization.
- `src/dsp/decoder.worker.ts`: shared FFT, source sample clock, decoder lifecycle and transfer of output buffers. Add manifests and native-backed factories to extend the application; unknown or unimplemented decoders are not listed.
- `wasm/src/lib.rs`: WFM oscillator/mixer → 401-tap complex FIR and 10× decimation → phase-difference FM discriminator at 240 kHz → coherent 19 kHz pilot recovery / regenerated 38 kHz difference demodulation → matched 161-tap 15 kHz sum/difference filters and 5× decimation → 38 kHz discriminator-response correction / L/R matrix → per-channel de-emphasis/DC removal → interleaved 48 kHz stereo PCM. The pilot detector requires sufficient level and phase coherence for 80 ms, releases after 20 ms of loss, and fades separation over 40 ms. The phase relationship follows [ITU-R BS.450, §2.2](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.450-2-199510-S!!PDF-E.pdf). State persists across USB blocks; configuration changes reset it with a short muted warmup.
- `public/audio-worklet.js`: bounded stereo audio FIFO, 60 ms prebuffer, and independent left/right interpolation to the actual audio device sample rate. Pause/stop/configuration changes flush queued audio.
- `src/components/Spectrum.tsx`: FFT rendering and waterfall, independently cropped to the selected display span. FFT runs in the worker, with no main-thread sample processing.

The WebUSB library and receiver/worker/canvas patterns follow the local reference apps at `../armer/web` and `../meteor-m`. The WFM decoder is implemented for this project. The underlying driver API is documented at [jtarrio/webrtlsdr](https://github.com/jtarrio/webrtlsdr); Chrome's requirements are described in [Access USB Devices on the Web](https://developer.chrome.com/docs/capabilities/usb).

## Verification

```sh
npm test                 # Tuning/FFT mapping, USB lifecycle and failures, audio resampling
npm run test:wasm        # Rust DSP tests plus the actual generated WASM in Node
npm run build            # Strict TypeScript and production build
npm run check            # All three above
npm run test:browser     # WFM regression; dev or preview server must be running
npm run test:browser:wwv # Actual CU8 AM IQ -> WASM -> confirmed time code and AM audio
npm run test:browser:am  # Standalone AM audio, bandwidths, tuning, playback controls
npm run test:browser:armer # P25 IQ/audio, talkgroup policies, aliases and XML interchange
npm run test:fieldglass    # Exact parity with the actual ../armer/web WASM module
```

`test:fieldglass` defaults to the reference WASM in `../armer/web/src/wasm`; set `FIELDGLASS_WASM_DIR` for another location. Set `ARMER_CAPTURE` to a CU8 file to compare recorded IQ too, with `ARMER_CENTER` set to its capture center (default 852400000 Hz). The control frequency is 853075000 Hz. This comparison does not access USB or change the reference app.

Browser tests use `/usr/bin/google-chrome`; set `CHROME_PATH` to override, and `APP_URL` to test another local port. Tests use actual Worker/WASM/AudioWorklet code and measure the rendered audio through a Web Audio analyser. They verify separate 1 kHz left / 2 kHz right output with at least 25 dB channel separation, stereo pilot lock, forced mono, display-only zoom, channel selection and isolation, both frequency-offset signs, de-emphasis, view freeze, decoder switching, PNG download, waterfall history, stop/restart, and layouts at 390/768/1024/1440 pixels. Screenshots and results go in ignored `artifacts/`.

An optional hardware integration test opens Chrome and **uses the attached receiver**:

```sh
npm run test:usb
```

Choose the receiver in its USB picker. On Linux the test launches Chrome with X11; a graphical desktop is required. It checks actual 2.4 MSPS reads, WFM PCM generation, hardware tuning, independent display span, PPM, audio start, and USB release/reconnect. This test is excluded from `npm run check`.

Verified on the connected **Nooelec NESDR SMArt v5-C**: more than 11 million live IQ samples, no observed ADC clipping, successful retune/PPM/audio start, and stop/reconnect. This verifies the hardware/data/audio path; intelligibility depends on the selected station and received signal. The stereo path is separately verified with generated multiplex IQ through the actual WASM and browser audio output: left approximately 1002 Hz and right approximately 1998 Hz (FFT bin resolution), with over 25 dB channel separation. Native tests also cover arbitrary pilot phase, ±2 Hz pilot error, absent/lost pilots, noise rejection, and mono fallback. Live-station stereo separation has not been measured.

## Rebuild WASM

Install Rust, the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli` **0.2.130**, then:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked
npm run build:wasm
npm run test:wasm
```

The generated JS, declarations, and `.wasm` in `src/wasm/` belong together and should be versioned together. Changes to Rust require rebuilding before browser tests/builds. Third-party notices and runtime license files are in `public/licenses/`.
