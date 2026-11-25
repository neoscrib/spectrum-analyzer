# Spectrum

A browser-based RTL-SDR spectrum analyzer with a WebUSB receiver and WebAssembly WFM stereo, NFM, AM, optional EAS/SAME audio, OOK/ASK, rtl_433, WWV time-code, ARMER P25 Phase I, and Meteor-M LRPT decoders. React, TypeScript, and Vite; reception and decoding run locally. RadioReference alias lookup and TLE refresh are optional network services.

```sh
npm ci
npm run dev
```

Open **http://localhost:5176** in Chrome or Edge on the computer with your RTL-SDR. Development uses port 5176; the installable production app uses port 5177. Both servers bind to loopback and avoid the reference apps. Generated WASM is included; normal frontend development requires Node/npm, not Rust; optional alias lookup also uses Go 1.26+. The verification scripts import TypeScript fixtures directly and need Node 22.18+ (Node 26 is used here).

## Install and use offline

```sh
npm run app
```

Open **http://localhost:5177** in Chrome or Edge. The development page at port 5176 also has an **Install app** entry that opens this version in a new tab while keeping the current radio session open. Choose **Install app** in the installable version’s header, wait for **Offline ready**, then choose **Install Spectrum**. The browser also offers installation from its address bar/menu when eligible. Installed Spectrum opens in its own window. On the first visit, leave the page open until offline setup finishes; installation alone does not guarantee all files have been saved.

`vite-plugin-pwa` generates the install manifest and injects the offline inventory; Workbox handles revisioned precaching and incremental updates. The production build caches the complete app, nested worker chunks, all nine WASM binaries (shared core plus decoders), the audio worklet, fonts, icons and license/source files—about **3.6 MB uncompressed**. These are disk-cache downloads; only the selected decoder and its dependencies are instantiated in memory. After **Offline ready**, the app can reopen and receive/decode/play audio/record IQ with the network disconnected and the local server stopped. WebUSB still needs Chrome or Edge and your normal receiver permission. RadioReference lookup needs a running API server and internet access; saved aliases, manual aliases and XML import/export work offline. Clearing site data or browser storage eviction removes offline files; reopen online to prepare them again.

Updates download in the background and wait. **Install app / App → Update and reload** is available only after reception stops and recording has finished saving. Other open Spectrum windows must also be closed before applying an update, so another receiver session is not interrupted. Workbox removes obsolete asset revisions only when the new worker activates. A failed/incomplete download never reports **Offline ready** and can be retried from the app menu. The cache excludes API calls, credentials and recorded IQ. Only small app-specific worker messages remain for complete-cache verification, repair, and the multi-window update guard.

The development server remains at **5176** and does not register a service worker; preview defaults to **5177** to keep offline production caches away from HMR. To rebuild and serve an update, rerun `npm run app`; an already built app can be served with `npm run preview`. Both servers bind to loopback. Browser settings and USB permissions belong to the exact origin: `localhost` and `127.0.0.1`, or different ports, have separate storage. To retain existing development-origin preferences when installing, stop the development server and run `npm run preview -- --port 5176`, opening it with the same hostname you used before. Return to the dedicated development origin for HMR, or unregister the production service worker in browser developer tools before reusing that origin for development.

For HTTPS hosting, serve the contents of `dist/` at the origin root. Use revalidation/no-cache headers for `sw.js` and `index.html`; hashed assets may be cached immutably. Static hosting supports all local radio features; the optional `/api/tle` and `/api/armer/aliases` endpoints is provided by the Go API. The plugin uses `injectManifest` and `registerType: "prompt"`; its [offline precache configuration](https://vite-pwa-org.netlify.app/guide/service-worker-precache) explicitly includes WASM, nested workers, fonts and public license/source files. Manifest/installation requirements are described by [Chrome's installation guide](https://web.dev/articles/install-criteria), and updates follow the [service worker lifecycle](https://web.dev/articles/service-worker-lifecycle).

`npm run test:browser:pwa` starts its own temporary production server and a disposable, non-incognito Chrome profile. It checks Chrome installability, all decoder files, server-stopped/offline cold starts for every decoder, real AudioWorklet playback, offline IQ recording, browser restart without a server, mobile/desktop layouts, API cache exclusion, deferred updates, multiple-window protection, and retry after a failed decoder download. It never installs into your personal browser profile or accesses USB hardware.

## EAS / SAME emergency alert audio

Enable **Decode EAS/SAME** in the EAS / SAME panel while AM, NFM or WFM is selected.
One optional, separately loaded WASM audio decoder handles NOAA Weather Radio
and commercial EAS broadcasts, including raw headers, repeated-header recovery,
EOM markers, geographic/event filtering and independently observed NOAA/EAS
attention tones. Normal audio, stereo, RDS and squelch behavior are preserved;
NFM data is tapped before muting. Historical CU8 IQ replay and bounded PCM WAV
analysis are available in the same panel.

For the reception example near Mora, Minnesota: **162.425 MHz, NFM, 25 kHz width,
±5 kHz deviation**; Kanabec County SAME code **027065**. SAME is transmitted during
applicable alerts/tests rather than continuously. Single headers, repeated
agreement and recovered messages have distinct labels. Expiration uses issue
time plus purge; the year is explicitly inferred from the capture reference.
SAME has no checksum or authentication.

This is an **experimental receiver, not a substitute for a dedicated emergency
alert radio**. No automatic notifications or unmuting are performed. See
[the SAME guide](docs/same.md) for protocol details, offline county aliases,
filtering, file/replay instructions, validation commands and limitations.

## Docker and GHCR

The production Kubernetes deployment at **https://spectrumsdr.com** uses the
existing Traefik Gateway and cert-manager Spaceship DNS challenge. See
[deployment manifests and instructions](deploy/kubernetes/README.md).

```sh
# Set RR_APP_KEY in .env.local (see .env.example), then:
docker compose --env-file .env.local up --build
```

Open **http://localhost:8080**. Compose runs nginx for the production app and a small Go API for RadioReference. Only nginx is exposed to the host; `/api/` is forwarded over the private Docker network. The application key is injected into Go at runtime, not baked into either image or the browser bundle. Each user supplies their own RadioReference Premium login when requesting aliases. Without a key, radio reception and saved/manual aliases still work; lookup stays unconfigured. Omit `--env-file .env.local` to start without a key file.

The checked-in WASM artifacts are used directly; Rust and Emscripten are not needed for image builds. The RTL-SDR connects to the computer running the browser through WebUSB. Put nginx behind HTTPS for remote access. nginx revalidates HTML and the service worker, caches hashed assets for a year, serves WASM/manifest MIME types, and returns 404 for missing assets. If the API is stopped, the app remains usable and lookup returns a clear error.

For local development, start `RR_APP_KEY=your-key npm run api` in another terminal. The Go service listens on `127.0.0.1:8081` by default (`LISTEN_ADDR` overrides it); Vite development and preview proxy `/api` there. The Go API uses only the standard library. It preserves the existing `GET /api/armer/aliases` configuration check and `POST /api/armer/aliases` credential/alias JSON contract. Upstream access is fixed to the RadioReference HTTPS SOAP endpoint and ARMER system 3508. Requests time out, bodies are bounded, credentials are never logged or cached, and errors do not echo upstream payloads. Saved aliases remain available offline. `GET /api/tle?id=…` additionally proxies CelesTrak for the four Meteor catalog IDs, with bounded responses and a one-hour in-memory cache; this does not need an RR key.

RadioReference's SOAP endpoint currently returns no CORS permission headers for the browser's XML/SOAP preflight (checked November 23, 2026), so these calls use the same-origin Go proxy. There is one SOAP implementation; the former Node/Vite middleware has been removed.

`.github/workflows/publish.yml` builds both images on **master** pushes or manual runs, using the built-in `GITHUB_TOKEN` with `packages: write`:

- `ghcr.io/neoscrib/spectrum-analyzer` — nginx and the app
- `ghcr.io/neoscrib/spectrum-analyzer-api` — Go API, a static binary and CA certificates

Each image receives `latest` and full commit-SHA tags. After publishing, use `docker compose --env-file .env.local pull` followed by `docker compose --env-file .env.local up -d --no-build`. Authenticate with `docker login ghcr.io` first if the packages are private. A frontend-only image can still run on its own; lookup requires the Go service.

## Receive and decode

1. Close other applications using the dongle. Click **Connect RTL-SDR** and select the receiver in Chrome's USB chooser. Supported WebUSB IDs are Realtek `0bda:2832` and `0bda:2838`, with R820T/R828D-family tuners.
2. Enter a **center frequency** in MHz and press **Tune**. This changes the hardware frequency. Retuning preserves the decoder's offset for WFM/AM/NFM/OOK/WWV. ARMER keeps its absolute control frequency fixed while you reposition the capture.
3. Set **display span** from 25 kHz to 2.4 MHz. This crops the spectrum around the center; the hardware continues capturing at **2.4 MSPS**. Zooming does not change decoder tuning or its channel filter. Spans wider than the captured band are intentionally unavailable; there is no sweep mode.
4. Select **Decode as… → WFM**, then click a station on the spectrum or enter its **decoder frequency** and press **Set**. The decoder independently mixes and filters that channel from the captured IQ. Its entire channel must fit inside the capture. Keyboard users can focus the spectrum and use left/right arrows (10 kHz; Shift for 100 kHz).
5. Click **Play audio**. WFM outputs **stereo, 48 kHz PCM**, with a 15 kHz audio low-pass per channel and selectable 75 µs, 50 µs, or no de-emphasis. **Auto stereo** recovers the broadcast’s 19 kHz pilot and 38 kHz difference channel. The output indicator reports **Stereo · pilot locked** after acquisition. Without a stable pilot it smoothly falls back to mono; choose **Mono** to force mono output on noisy stations. The WFM RDS/RBDS panel decodes broadcast station information by default.

**Channel width** is the digital WFM filter width, independently selectable from 150–220 kHz. **Tuner gain** and **frequency correction** apply with the RF settings button while connected. Connecting uses the currently displayed RF draft values. The RF panel explicitly shows the applied/saved values and flags pending changes, so a slider draft cannot be mistaken for a hardware setting. The driver rounds manual gain to a supported hardware step. Bias tee stays off. Stop releases the USB interface; reconnect reuses the selected receiver. After a disconnect/error, the next connection opens the chooser again.

Use **Try FM test signal** to run generated CU8 IQ through the exact same FFT, WASM decoder, and AudioWorklet. The source is clearly labeled, resets tuning to 100.0000 MHz / 100.1000 MHz, and produces a stereo multiplex with **1 kHz on the left, 2 kHz on the right**, a 19 kHz pilot, and two neighboring test carriers. It never accesses the receiver. Gain and PPM have no effect on this generated source.

**Multiplex spectrum** in the WFM decoder panel opens a one-sided **0–65 kHz**
plot below the RF spectrum. It observes the real FM discriminator output at
**240 kSPS**, before pilot recovery, stereo decoding, the 15 kHz audio filters,
de-emphasis, and conversion to 48 kHz PCM. Its 120 kHz Nyquist limit covers the
whole display. Bin positions use the tap's actual sample rate and FFT length:
4,096-point Hann FFTs give **58.6 Hz/bin** at the current rate. Linear bin power
is averaged with a **0.6 s** time constant before conversion to dB; the display
updates at most ten times per source second. The tap, FFT and publication are
disabled while this view is closed.

References identify **L+R at 0–15 kHz**, the **19 kHz pilot**, **L−R at 23–53 kHz
centered on 38 kHz**, and **RDS/RBDS at 57 kHz**. The last is a frequency
reference, not a presence detector; the separate RDS/RBDS panel confirms reception from CRC-valid data.
**Vertical zoom** and **Top** change only the displayed dB range, independently
of tuner gain. Levels are relative to a full-deviation (75 kHz) tone, not RF
dBm. The plot remains available in auto stereo and forced mono. View toggles
and mono/stereo changes preserve decoder state, the sample clock, and queued
audio. The FM test signal now includes actual encoded test RDS around **57 kHz**,
with the synthetic station name **SPECTRUM** and a fixed RadioText message.

The spectrum is an 8,192-point Hann-windowed FFT (293 Hz/bin at 2.4 MSPS). Display zoom does not increase FFT resolution. Trace smoothing, peak hold, display floor, waterfall, and PNG export are available. **Freeze view** leaves acquisition and audio running. Power is relative **dBFS**, not calibrated dBm or SNR. Input power includes the full captured band; ADC clipping counts samples at the converter limits. DSP processing is time spent processing one block divided by that block's RF duration, not total machine CPU usage.

Uncheck **Show spectrum & waterfall** above the plots to hide both views and their plot controls. The display preference persists locally. While hidden, the main RF FFT and canvas rendering stop; tuning, decoder panels, audio, and IQ recording keep running. Showing the plots again starts a fresh live display. The WFM multiplex spectrum has its own independent visibility control.

The shared analog DSP folds symmetric FIR taps, uses fixed-size chunks and independent accumulators, and processes I/Q together to share coefficient loads and ring bookkeeping. Mixer/decimation counters avoid high-rate integer division. NFM squelch compares linear power with the existing 3 dB hysteresis; dB conversion remains in telemetry. CTCSS evaluates its tolerance candidates together on one unwrapped sample window. These optimizations use portable scalar WASM and do not require SIMD support.

WFM channel filtering runs in two stages: **2.4 MSPS → 480 kSPS → 240 kSPS**. A broad 71-tap anti-alias filter precedes the 81-tap channel filter, which preserves the previous 401-tap filter's cutoff and transition width. RDS similarly filters at **240 → 48 → 24 kSPS**. Pilot lock compares power directly, calculating its displayed amplitude once per block. Fully mono output skips the unused difference-channel convolution while retaining its filter history for stereo acquisition. RDS display updates are batched with signal-monitor updates to avoid extra app renders. Desktop before/after benchmarks measured approximately **40% less WFM DSP time** than the previous optimized version, with stereo and RDS enabled; these figures do not measure a particular phone's CPU usage. Regression checks cover channel response, alias rejection, stereo separation, RDS, multiplex observation and arbitrary input chunk boundaries.

Generated test sources wait for DSP and can slow down. Live USB must sustain the full 2.4 MSPS input, so a successful demo alone does not establish live throughput. `npm run test:browser:live-dsp` uses the Vite development server, a virtual RTL-SDR provider delivering continuously paced CU8, the actual capture/read queue and decoder workers, and audible AudioWorklet output. It tests WFM, AM and NFM including WFM and open-squelch NFM static under Chrome CPU throttling (`CPU_THROTTLE`, default 4; `LIVE_DSP_SECONDS`, default 12). Use `LIVE_DSP_DECODERS=wfm LIVE_DSP_SECONDS=90 CPU_THROTTLE=4 npm run test:browser:live-dsp` for longer WFM-only tone and static checks. It never opens physical USB hardware and refuses to run if provider interception fails. This stress test is not an emulation or validation of a Pixel 5. The bounded live-input overload guard still stops reception instead of silently dropping samples.

Settings persist in browser-local storage. IQ/audio are processed locally and are not uploaded. In-app IQ replay, other modulation modes, and arbitrary-rate tuners remain future extensions.

## RDS / RBDS station information

**Decode RDS/RBDS** is enabled by default for WFM. The station panel shows the
transmitted **PI code**, eight-character **Program Service name**, **RadioText**,
and **program type**. Broadcast details are collapsed by default and contain
TP/TA, music/speech, the broadcast UTC clock and local offset, group counts, and
the last validated group. Choose **RBDS · North America** or **RDS · International**
for PTY labels; this is a saved display preference and does not retune the radio.
PI is displayed as transmitted, without guessing call letters from it.

The Rust WFM module feeds its real **240 kSPS discriminator output** directly to
an independent 57 kHz quadrature downconverter, narrow low-pass filter and
24 kSPS decimator. Parallel biphase timing hypotheses and complex differential
symbol decisions recover the 1187.5 bit/s stream without depending on stereo
pilot lock. The receiver accepts only complete A/B/C(or C′)/D groups with all
four (26,16) CRC/offset checks valid, including the repeated PI in version B.
Two unique valid groups with the same PI confirm reception. This first version
rejects damaged blocks rather than attempting error correction. A spectral peak
or pilot lock alone never reports RDS reception.

Implemented metadata groups: **0A/0B** (PS and traffic/music flags), **2A/2B**
(64/32-character RadioText with A/B message resets), and **4A** (clock/date).
PS segments must repeat consistently; RadioText is published after all segments
through its terminator, or its entire fixed-length buffer, have arrived.
The G0 repertoire includes accented characters. Other group types are counted;
AF, RT+, TMC, EON and RDS2 additional streams are not interpreted. The protocol
references are [NRSC-4-B](https://www.nrscstandards.org/standards-and-guidelines/documents/archive/nrsc-4-b-standard-2005.pdf)
and its [coding/character annexes](https://www.nrscstandards.org/standards-and-guidelines/documents/archive/nrsc-4-a-annexes-2005.pdf).

RDS reception works with the multiplex plot closed and with forced mono audio.
The optional spectrum still performs no FFT work while closed. Switching audio
mode, toggling the plot, and toggling RDS do not reset PCM or retune the receiver.
Disabling RDS releases its demodulator state and clears station information;
re-enabling reacquires it. After two seconds without a validated group, the
panel reports signal loss and labels retained fields as last decoded information.
The transmitted clock is displayed as data and does not change the system clock.

**Try FM test signal** transmits synthetic PI `1234`, PS **SPECTRUM**, RadioText
**Spectrum SDR - browser WASM RDS/RBDS demo**, PTY 10, and a fixed test CT timestamp.
It uses a separate JavaScript differential/biphase encoder and runs through the
same CU8 channelizer, WFM demodulator and Rust RDS receiver as live input.
Tests cover independent published CRC words, every single-bit group corruption,
C′ handling, text assembly/reset, noise/tone rejection, carrier phase/error,
clock drift, PCM equality with RDS enabled/disabled, and browser playback.
An independent [redsea MPX recording](https://github.com/windytan/redsea/blob/b16943e17f6b954c87a70a35307691fc1bf5b735/test/resources/mpx-testfile-yksi.flac)
also recovers its expected PI `6201` and PTY 14 through the actual WASM.
Live RDS reception with the attached receiver has not been tested for this change.

## Record IQ

Start the receiver (or a generated test source), then use the **IQ recording** panel. Choose a duration and press **Record IQ**. Recording saves the full **2.4 MSPS / 2.4 MHz capture**, before channel filtering, as headerless interleaved **unsigned 8-bit I, Q** (`.cu8`, zero near 127.5). Data volume is **4.8 MB/s / 288 MB/min**. Decoder audio, spectrum display zoom, and view freeze continue independently. Squelch does not gate recording; quiet and active portions are both retained.

- **Folder · stream to disk** uses Chrome/Edge's [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access). Select a folder for the capture; samples stream to a new uniquely named file without holding the whole capture in RAM. Stop manually, choose an automatic RF duration, or record until stopped. IQ and metadata are finalized in that folder; wait for **Saved to chosen folder** before closing the tab. Browser folder access can be canceled without interrupting reception.
- **Download · up to 64 MiB** works without a folder picker. It retains one bounded capture in memory (about **14 seconds maximum** at 2.4 MSPS). After recording, click **Download IQ (.cu8)** and **Download SigMF metadata** separately. Download both before starting a new recording, discarding, reloading, or closing the tab. A requested duration longer than the memory limit ends at the limit.

The matching `.sigmf-meta` file follows [SigMF 1.2.6](https://sigmf.org/) with datatype `cu8`, sample rate, center frequency, host start timestamp, sample count, recorder, source provenance, and notes on requested gain/PPM and stop reason. Its `core:dataset` names the matching `.cu8` file; keep the pair together. The raw file can also be opened by software accepting CU8 at 2400000 samples/s with the recorded center frequency. Decoder channel width is recorded as context and has not been applied to the raw samples. Host timestamps are approximate receipt times, not calibrated receiver timestamps. File duration is calculated from the actual sample count.

Recording pauses bank scanning on the current RF window. Other windows are not captured. Applying receiver or decoder settings finishes the file before the endpoint/decoder resets; the next recording starts a new file. Stopping or losing the receiver also finalizes the recorded prefix. Storage writes use a bounded **16 MiB** queue; if storage falls behind, acquisition continues and recording ends at a contiguous prefix instead of skipping IQ and resuming. Write/close errors are reported without claiming a successful save. If IQ succeeds but its sidecar fails, download the retained metadata. The RTL-SDR has no sample timestamps here, so this does not verify hardware/USB continuity independently.

Generated recordings have **GENERATED** in their filenames and explicit test provenance in their metadata. The browser test records OOK/ASK IQ, downloads it, decodes that saved file through the real WASM decoder to recover `A6`, and verifies a direct-to-folder capture using actual Chromium file streams (with only the native folder chooser replaced by an origin-private test directory). It also checks byte/sample counts, metadata, cancel, retune/stop boundaries, display-only controls, audio playback during recording, holding a quiet scan window for the full recording duration, and responsive layouts. The generated sidecar was also validated against the official SigMF 1.2.6 JSON schema. Unit tests cover write order, queue/memory limits, disk/sidecar failures, stale capture IDs, policy changes, and RF metadata snapshots. Live receiver recording has not yet been independently verified. In-app recording replay is not implemented yet.

## rtl_433 device protocols

Select **Decode as… → rtl_433 · ISM devices**, tune your center near the desired band, and set **Decoder frequency** to the device's frequency (for example **433.920 MHz**). Selecting this decoder preserves your current tuning. Center **433.750 MHz** and decoder **433.920 MHz** keep a 433.92 MHz signal away from the hardware center/DC spike. Use a suitable antenna, gain, and decoder channel width; 200 kHz is the default. Display span remains independent.

This embeds the actual [rtl_433 25.12](https://github.com/merbanan/rtl_433/tree/25.12) C engine, compiled to WASM with **all 284 visible protocols**. Its **253 upstream default-enabled protocols** run initially. Select **All protocols** to include the 31 optional decoders, or **One protocol** to reduce ambiguity and processing. Names/numbers come from the compiled registry. All mode can produce more false positives, especially with protocols without checksums. OOK threshold is automatic by default; a manual threshold is relative to filtered IQ. OOK/FSK burst counts indicate detector activity, not CRC validation counts or supported-device counts.

The shared Rust IQ channelizer selects the decoder channel, filters it, and converts 2.4 MSPS CU8 to **240 kSPS signed 16-bit IQ**. The upstream engine retains pulse/demodulation state across input blocks and emits structured JSON with model, ID, protocol, and device-specific fields. This is a data decoder; it does not produce audio. The full registry is available, but protocols requiring a wider channel, another sample rate, or different RF hardware are not guaranteed to work in this pipeline. Frequencies other than 433 MHz are supported within the receiver's tuning range.

The message viewer keeps the latest **300 messages**, searches all decoded fields, and exports the full retained history as **JSONL**. Each line wraps the unchanged upstream `data` object with host receipt time, source (`live` or `test`), selected frequency/bandwidth, and engine version. Upstream `time` is relative to the current decoder session, not UTC; retuning/reconfiguring restarts that clock. RF levels are relative, not calibrated dBm. Encrypted protocols may expose headers and opaque encrypted fields; the decoder does not decrypt them.

**Try rtl_433 test signal** generates two local RF fixtures at 433.920 MHz every three seconds: a Nexus-TH OOK temperature/humidity message (ID 66, 21.5 °C, 56%) and a fabricated SimpliSafe-Gen3 FSK frame with a valid wire CRC. Its opaque payload/tag bytes are fixtures, not actual encrypted/authenticated messages. Both pass through the real worker/channelizer/rtl_433 engine; generated messages remain marked as test data in history and export. No RF is transmitted.

`npm run test:rtl433` verifies both modulation families, positive/negative tuning offsets, three channel widths, arbitrary block sizes, manual/automatic threshold, protocol selection, and reuse of native state. `npm run test:browser:rtl433` checks the actual worker, message UI, protocol changes, exports, decoder switching, and responsive layouts. An optional `RTL433_CAPTURE=/path/to/the/controlled-before.cu8 npm run test:rtl433` regression verifies the user's 12 known CRC-valid Gen3 frames without bundling private IQ. Live SimpliSafe-Gen3 reception was confirmed by the user: the browser decoded CRC-valid FSK frames with sensor ID, counter, CMAC, and opaque encrypted payload. The payload remains encrypted and the CMAC is not verified.

The generated JS/WASM are included. To rebuild them, install **Emscripten 7.0.0**, CMake 3.x and Python 3, activate emsdk, then run **`npm run build:rtl433`**. The build verifies and extracts the bundled upstream source archive into ignored `artifacts/rtl433-build`, adjusts only its scratch-buffer capacity for bounded calls, and builds without SDR hardware/network dependencies. `wasm/rtl433/bridge.c` embeds the upstream streaming callback. Keep `src/wasm-rtl433/rtl433.js` and `.wasm` together. The complete upstream source, GPL-2.0-or-later license, adapter source, build script and notices are served in **`public/licenses/rtl_433-*`**; preserve them when distributing covered builds.

## AM audio

Select **Decode as… → AM · amplitude modulation**, tune the desired channel, and click **Play audio**. Selecting AM preserves your hardware center and decoder frequency. Channel widths are **6, 8, 10, 12, or 16 kHz** (10 kHz default), independent of the display span and 2.4 MSPS capture. Output is 48 kHz mono, duplicated to both speakers. The AM envelope detector normalizes slowly against the carrier to compensate for RF level changes. Playback adds a 20 Hz DC blocker and a short muted startup; WWV time-code processing receives the original normalized AM before that playback filter. FM stereo and de-emphasis controls do not apply to AM.

The current tuner path remains 24–1766 MHz; selecting AM does not add lower-frequency reception. **Try AM test signal** generates a 1 kHz AM station at **120.100 MHz**, with a neighboring 3 kHz AM station at **120.140 MHz**, captured around 120.000 MHz. This is explicitly labeled synthetic data and uses the actual WASM and AudioWorklet. Select the neighboring carrier to hear its different tone.

`dsp_core_bg.wasm` supplies the shared high-rate channelizer; `wasm/src/am.rs` supplies the common AM envelope detector source. Standalone `AmDecoder` emits only audio; `WwvDecoder` uses the identical demodulator and additionally feeds its 100 Hz protocol decoder. Rust tests verify both tuning-offset signs, adjacent-channel rejection, channel-width filtering, mono output, and arbitrary IQ chunk boundaries. Browser tests measure rendered audio, select the neighboring station, retune across the center, and check volume/pause/stop and responsive layout.

## NFM, frequency presets, and scanning

Use **Frequency banks → FRS / GMRS → Channel 1 → Tune**, then **Connect RTL-SDR** and **Play audio**. Channel names are also clickable, including on narrow screens. Or choose **Decode as… → NFM** and enter any supported frequency directly. **Channel width** is configurable at 10/12.5/15/20/25 kHz; **FM deviation** independently selects ±2.5/5/7.5 kHz for audio scaling. Shared FRS/GMRS presets start at 12.5 kHz and ±2.5 kHz. Widen the filter/deviation when needed for a wider analog FM transmission. Output is mono, duplicated to both speakers at 48 kHz, with a fourth-order 300 Hz high-pass, 3.2 kHz low-pass, and 750 µs de-emphasis.

**Squelch** combines a configurable relative channel-power threshold with an out-of-voice-band FM noise detector, 3 dB level hysteresis, a 20 ms opening qualification, and approximately 250 ms hang time. The default threshold is −65 dBFS. It is not calibrated dBm; adjust for your receiver's noise level/gain. **Off** opens the audio monitor, including noise. Code detection receives the un-deemphasized discriminator before voice filtering. Proper anti-alias filters at 24 kHz → 4.8 kHz → 1.2 kHz prevent voice tones aliasing into signalling frequencies.

**Code filter → Any code** detects signalling without restricting playback. An optional CTCSS/DCS filter unmutes only a confirmed match. The implementation recognizes 50 common CTCSS frequencies and the 83 DCS codes in [ETSI TS 103 236](https://www.etsi.org/deliver/etsi_ts/103200_103299/103236/01.01.01_60/ts_103236v010101p.pdf), in both polarities. DCS uses repeated 23-bit Golay words at 134.4 bit/s; detection requires four successive matching words, allowing at most one differing bit per word. Some code/polarity pairs represent the same cyclic waveform, so equivalents appear together (for example **023N / 047I**). This does not infer a radio manufacturer's proprietary “privacy code” numbering. Codes are not encryption. Allow roughly 1–2 seconds for stable detection; very brief or weak calls may produce audio without an identified code.

The reusable preset library includes:

- **22 FRS/GMRS shared channels**, using the exact frequencies in [47 CFR 95.563](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-D/part-95/subpart-B/section-95.563).
- **Seven NOAA weather frequencies**, named by frequency to avoid inconsistent WX numbering; see the [National Weather Service](https://www.weather.gov/abr/nwr).
- **US amateur FM calling frequencies** from the [ARRL band plan](https://www.arrl.org/band-plan).
- **A US marine simplex voice subset**, with the [US Coast Guard channel reference](https://navcen.uscg.gov/us-vhf-channel-information). This is not a complete marine/digital/repeater allocation table.
- **My frequencies** and user-created banks. Save/edit names, exact frequencies, AM/NFM/WFM modulation, filter width, and NFM deviation/squelch/code filters. AM/WFM presets tune individually; parallel bank monitoring currently supports NFM.

Click **Monitor / scan bank** to connect if needed or reuse the current source. All enabled NFM presets in the current 2.4 MHz capture run as independent WASM virtual receivers, up to **16 at once**. Only one active receiver is routed to playback, keeping the selected call until it closes. FRS/GMRS groups into **15 receivers around 462 MHz and seven around 467 MHz**. The tuner alternates windows after at least 0.75 seconds of quiet stream time, rather than retuning for each channel. Carrier activity holds the RF window, even while waiting for a code match. **Hold channel** pins the selected receiver/window after a call ends; **Resume scan** returns to automatic selection. **Next window** deliberately skips the current observation. Other RF windows cannot be monitored simultaneously with this one dongle. Display zoom does not change any virtual receiver, and gain/PPM changes retain the active bank configuration.

Banks and per-preset settings persist locally. Export/import the versioned JSON library to back them up; imports replace the library after validation. Libraries are bounded to 50 banks / 2,000 total presets / 200 presets per bank and 1 MB per imported file. A bank reset restores that bank's supplied channels. Activity history records all detected carrier openings in the observed window, even when another channel is playing, with observed duration, peak level, and detected code. It retains up to 300 observations (the latest 60 are shown) and exports CSV. Stop/retune marks interrupted observations; it does not claim an unobserved transmission ended. Live observations persist; generated test observations are labelled and excluded from saved RF history.

**Try NFM test signal** generates scheduled CU8 transmissions, with overlapping channels: CH 1 has a 1 kHz voice test tone plus 100 Hz CTCSS, CH 2 a 1.5 kHz tone plus DCS 023N, and CH 8 a 2 kHz tone plus 88.5 Hz CTCSS in the other RF window. The 12-second sequence repeats. Run bank monitoring against that source to exercise scanning and parallel activity detection without accessing USB. Tests verify audible tones through the actual WASM/AudioWorklet, subaudible-tone suppression, CTCSS/DCS identification, squelch release, two-window scanning, hold/resume, one audio stream, independent activity history, custom-bank persistence, JSON/CSV export/import, and responsive layouts. Native tests additionally reject noise and voice-only false codes, preserve arbitrary chunk boundaries, and cover positive/negative tuning offsets. **Live over-the-air NFM reception has not yet been verified.**

## OOK / binary ASK

Choose **Decode as… → OOK / ASK · pulse data**, keep or enter the target frequency, and connect the receiver. This is a data-only demodulator; playback is disabled. It supports on/off and two-level amplitude keying, not multilevel ASK or FSK. Channel widths are **10, 25, 50, or 100 kHz** (50 kHz default), independent of the display span. Move the hardware center away from the carrier to avoid the RTL-SDR DC artifact. The live envelope snapshot and threshold line help with level adjustment; short bursts can fall between display updates. Captured bursts retain their pulse train and full high/low durations.

**Automatic threshold** tracks low and peak amplitudes with hysteresis and a −55 dBFS minimum slicing threshold; it needs sufficient amplitude contrast. For weak signals or close ASK levels, choose **Manual** and put the dBFS threshold between low and high. Adjust RF gain without clipping. **Minimum pulse** qualifies both transitions to reject glitches (default 50 µs); **Burst idle gap** closes a capture after continuous low (default 5000 µs). Set the gap longer than any data low interval. A 20 ms startup is ignored. Oversized bursts (2048 runs or two seconds without a delimiter) are discarded until idle; no partial packet is presented as complete.

Raw timings are always retained. Optional **PWM** classifies high durations, **PPM** classifies low durations, and **NRZ** expands runs using an explicit bit period. Enter the short/long durations and optionally invert bits. Timing matches allow ±25%; `?` marks a mismatch. The final idle delimiter is excluded from PPM/NRZ data; trailing NRZ zeros cannot be inferred from an idle delimiter. The **Interpreted bits** area shows paired **Binary** and **Hex** dumps, grouped into bytes with four bytes per line and copy buttons. Hex is MSB-first and preserves complete nibbles for non-byte-aligned packets; a partial final nibble stays in binary brackets, for example `D6 AD [101]` is exactly 19 bits, with no zero padding. Unknown nibbles are `?`, while the binary dump keeps each uncertain bit in place. NRZ byte alignment after an uncertain-length run is tentative. Counts identify partial bytes, uncertain bits, and any interpretation truncation. Dumps and the waveform cover the entire captured signal, including a final high pulse with no recorded low gap. Changing interpretation applies to stored bursts as well. This is configurable bit interpretation, not automatic device recognition or checksum validation; temperature, IDs, button codes, Manchester framing, and other device-specific fields need protocol decoders.

Hover anywhere over the **pulse waveform** to inspect the actual stored high
pulse or low gap duration. The measured interval is outlined and labeled, for
example **High pulse · 280 µs · Bit 2 = 0** and **Low gap · 740 µs · Bit 2 = 0**.
Bits are numbered from 1. Alternating shading marks interpreted symbols:
PWM covers a high pulse plus its following data gap, with the high width making
the bit decision. A final high with no following gap ends at its captured falling
edge. PPM covers the corresponding high/low pair and decides from the low width;
NRZ cells are distributed over their measured run rather than reconstructed from
ideal widths. Unknown decisions keep their raw timing spans.

**Show byte boundaries** adds a divider after every eight interpreted bits,
aligned to the current hex grouping. Hovering a waveform symbol highlights its
binary digit and hex group; hovering a binary digit highlights its symbol, while
a hex group highlights up to eight bits and their waveform spans. A 33-bit packet
keeps its final **[0]** as a one-bit group. Bit and hex inspection also support
keyboard focus and arrow keys. Long dumps scroll internally to the linked bits;
the page does not jump away from the hovered waveform. The final observed idle
delimiter stays in the raw timing table and is omitted from the signal plot.
The interpretation API `interpretBurstWithTiming()` exposes bit values and their
`startUs`/`endUs` source spans, alongside every raw high/low interval.


Keep the newest **100 bursts** in memory, inspect older bursts while acquisition continues, **Export captures JSON** with frequency/filter/options and generated/RF provenance, or **Export pulse data (.ook)** for a selected burst. Pulse files use microsecond high/low pairs following the documented [rtl_433 pulse-data format](https://github.com/merbanan/rtl_433/blob/master/docs/IQ_FORMATS.md). The final low is an observed lower bound, not a measurement of the full silence. Capture history is not persisted across reloads; export it before closing. OOK settings persist locally.

**Try OOK / ASK test signal** generates PWM `A6` at **433.920 MHz**, captured around 433.750 MHz: 500/1000 µs highs, 500 µs lows, once per second, alternating on/off and nonzero-low ASK. Select PWM and apply 500/1000 µs to display `10100110` / `A6` (or `59` with inversion). All test captures are labelled generated, including exports and after stopping. Tests pass actual CU8 through WASM at both offset signs, reject an adjacent carrier and short glitches, preserve chunk boundaries, bound unterminated input, recover OOK and ASK, and exercise settings/history/export/responsive UI. **Live OOK reception was confirmed by the user on November 20, 2026:** ceiling-fan control signals were decoded and used to implement an ESPHome/ESP32 controller with a WRL-10534 transmitter.

`wasm/src/ook.rs` uses the shared mixer/complex FIR/decimator, then a second complex filter and magnitude detector at 120 kSPS, yielding **8.33 µs sample spacing**. Actual edge accuracy also depends on RF bandwidth, filter delay/ringing, signal level, and threshold; narrow filters blur short pulses. Filtering, thresholding, glitch qualification and burst acquisition run in WASM. The module emits typed pulse-message and telemetry events rather than audio. Implementation is original to this project; no rtl_433 decoder code is bundled.

## ARMER / P25 Phase I

Select **Decode as… → ARMER · P25 Phase I**. This reuses the C4FM trunking and IMBE pipeline from `../armer/web`, compiled into its own lazily loaded `armer_bg.wasm` module with `sdr-p25` 0.1.0. The starting site is **Ogilvie 5-75**, control **853.075 MHz**, captured around **852.400 MHz**. The saved alternate **853.875 MHz** can be selected manually; automatic control-channel rotation is not implemented. You can enter another control frequency, adjust the hardware center, and save that frequency. Display span only zooms the FFT; voice following uses the full 2.4 MHz capture.

Connect the receiver and press **Play audio**. The decoder learns broadcast channel plans, reports CRC-validated system/WACN/NAC/RFSS/site data, and follows **four simultaneous clear Phase I voice channels** by default. **Simultaneous voice channels** in Now Playing selects **1–8** receivers; choosing one restores single-call listening. The limit persists locally, and older saved configurations default to four. All voices share one loaded ARMER WASM module and the same 2.4 MSPS IQ stream. CPU usage increases with the number of allocated voice receivers. All nonzero talkgroup IDs, including unknown IDs, listen by default with equal priority. An already selected call is not preempted merely because another ID is numerically smaller. Calls outside the current capture remain visible in Now Playing. **CQPSK/LSM simulcast, Phase II voice, and encrypted audio are not supported.** Unknown encryption state is withheld until confirmed clear. Listen toggles apply to the actual transmitted group ID; a patched member does not override a muted group.

The **Talkgroups & calls** panel starts with 15 named aliases from your reference playlist, all enabled regardless of that playlist's original priorities. Discovered IDs appear automatically. Search, assign names/groups, add IDs, toggle individual entries, choose whether unlisted IDs listen, or use **Listen all / Mute all**. Configuration persists in browser-local storage. Live observations are bounded to 2,000 IDs, recent call history to 60 events. Generated observations are kept separate and never saved as received traffic. Name edits do not reset synchronization; listen-policy changes silence disabled groups without resetting other voice receivers or control state.

**Now Playing** shows frequency, talkgroup, current alias, source radio ID, text/color status and per-talkgroup audio controls. The control channel stays at the top in amber while CRC-valid control data is arriving. Multiple playing streams are green; eligible assignments awaiting a decoder say **Waiting for voice slot**. Encrypted calls are pink, muted/out-of-capture calls gray, and unresolved/unknown/unsupported states purple. A selected clear stream says **Audio paused** until playback is enabled. Playback identity includes both frequency and call generation, so a reused channel cannot inherit another call's playing status. **Mute**, **Solo**, volume and left/center/right pan change playback without restarting reception or releasing decoder slots. **Clear solo** remains available if the soloed call ends, and **Reset mix** restores all playback controls. Mix controls last for the current page session; listen policies and voice limits persist.

Each voice LDU exports its own stream ID and absolute RF-clock timestamp with 8 kHz PCM. The adapter resamples each stream independently to 48 kHz; the AudioWorklet mixes separate bounded circular buffers on a shared timeline with a 60 ms prebuffer. Lost LDUs leave silence, muted streams keep advancing, and ended calls drain independently. A shared peak limiter protects summed audio from clipping. A producer backlog exceeding 300 ms rebases the shared timeline instead of accumulating delayed speech. At most 16 live/retiring playback buffers are retained. This runs on the existing decoder worker and audio worklet without additional WASM modules, downloads or thread requirements.

The native decoder tracks up to **128 current voice-channel assignments**, including muted, encrypted and out-of-capture grants. Reusing a channel for another talkgroup replaces its prior source/encryption metadata and creates a fresh voice decoder/stream. Decoded voice activity refreshes the assignment and a decoded TDU terminator removes it immediately; otherwise it expires after **four RF seconds** without a grant or voice update. Control lock has a **two RF second** timeout. If receiver telemetry stops entirely, a **2.5-second browser watchdog** clears the active rows and lock indication. Stopping the receiver clears the table immediately. Current rows are separate from call history and are not persisted. Native/unit tests cover overlapping RF carriers, bounded allocation, independent call termination, policy continuity, timestamp alignment, missing LDUs, mixer clipping protection and 30 seconds of stable playback latency. Browser tests verify four generated voice carriers through actual WASM/audio playback, mute/solo/pan/volume, live voice limits, persisted configuration, aliases, signal loss, and responsive layout. These fixtures exercise IMBE with codec test data rather than intelligible speech or a new over-the-air multi-call reception.

**Decode as… → ARMER → Auto-center active talkgroups** is enabled by default, including for saved settings created before this option existed. It uses recent enabled Phase I assignments to find a 2.4 MHz window covering more distinct talkgroups, with channel-filter margins. Disabled, encrypted, stale and Phase II assignments do not drive retunes; unknown encryption states may be captured to establish whether they are clear. Every candidate retains the control channel, and the optimizer can protect a set of voice frequencies. Since hardware tuning resets RF demodulation, the app **waits while any clear call is playing audibly** before considering an automatic center change. Ties prefer clear calls, avoid placing a channel on the tuner center/DC spike, and balance signals within the window. A center changes only for a strict coverage improvement that remains stable for **800 ms**, with at least **five seconds** between automatic moves and a five-second grace period after manual tuning. Display zoom is independent.

Center-only changes drain old USB reads and reset RF-dependent DSP/audio queues while retaining band plans, system information, active assignments, sample time and decoder counters. The control frequency stays fixed. Hardware retuning can briefly interrupt audio. Auto-centering pauses while preparing, recording or saving IQ so a recording's center and SigMF metadata stay consistent, then resumes afterward. The checkbox can be disabled without resetting reception, and its setting persists. A single receiver cannot include arbitrarily distant channels alongside the control channel; frequencies whose span exceeds the usable 2.4 MHz window remain outside capture.

`npm run test:browser:armer-auto-center` exercises actual generated IQ through the worker/WASM, moves a reachable voice from outside to inside capture, verifies restored audio and retained decoder state, checks independent zoom, records ten RF seconds without a center change, validates the saved metadata, and verifies automatic resumption and preference persistence. Unit tests compare the optimizer against a full grid search and cover control/audio retention, unreachable channels, unique talkgroups, filtering and hysteresis. Native tests cover center-only state preservation, and transport tests cover draining USB reads and recording/tuning exclusion. The user confirmed working live-hardware auto-centering on November 23, 2026; the automated retuning and recording tests use generated IQ.

The ARMER panel has two collapsed accordions: **System summary** and **System broadcasts**. The summary is assembled from received control messages, like SDRTrunk's activity summary. It includes network WACN/system/NAC/LRA; current RFSS/site and active-connection status; primary/secondary control channels with downlink and uplink frequencies; neighboring sites and their status flags; frequency-band base, bandwidth, spacing, signed transmit offset and FDMA/TDMA slots; station ID/license; and active patch members with expiry. IDs show both hexadecimal and decimal values, including zero-valued LRA. Rx NAC on neighbor rows belongs to the control channel carrying the announcement, not a separately measured neighboring site's NAC. Frequencies are shown in MHz to 1 Hz precision.

The native decoder retains typed information independently of the message log and resolves channel frequencies against its learned band plans. Announcements received before their band plan become resolved when that plan arrives, including signed uplink offsets and explicit secondary uplink channels. Current-site secondary channels are filtered by RFSS/site, neighbor identities update in place, and patch groups expire using RF stream time. Standard single-block TSBK broadcasts and explicit secondary-control TSBKs are supported; multi-block AMBTC network summaries and over-the-air radio/talker aliases are not decoded yet. The alias section states that limitation rather than reporting an empty decoded alias directory. Editable talkgroup aliases remain separate.

Motorola **Base Station Identification (BSI)** can carry a readable callsign and its identification channel. It is a periodic manufacturer-0x90 / opcode-0x0B message with eight packed six-bit characters. Some sites send an empty field; the summary distinguishes waiting, empty and invalid character encodings. The ID channel does not cause a retune or start a voice call. [SDRTrunk's BSI parser](https://github.com/DSheirer/sdrtrunk/blob/master/src/main/java/io/github/dsheirer/module/decode/p25/phase1/message/tsbk/motorola/osp/MotorolaBaseStationId.java) and its [RFSS status parser](https://github.com/DSheirer/sdrtrunk/blob/master/src/main/java/io/github/dsheirer/module/decode/p25/phase1/message/tsbk/standard/osp/RFSSStatusBroadcast.java) independently document the wire layouts; parsing and descriptions here use the existing MIT-licensed sdr-p25 crate.

**System broadcasts** shows a compact table only when expanded: decoded description, opcode/manufacturer, repeat count, last RF stream timestamp and expandable raw data. It retains the latest **24 distinct messages**, folding repeats into a count. Only clear CRC-valid blocks enter either view. Summary state resets with receiver/decoder configuration, remains available when stopped and is not saved as an alias. The generated fixture advertises **TEST123**, system **40F / BEE07**, RFSS/site **5/75**, primary **853.075 MHz**, secondary **853.875 MHz**, neighbor **1/6 at 852.4625 MHz**, and 800/700 MHz band plans, all labeled test data. Native tests cover trust gates, empty/unmapped callsigns, late band plans, explicit unresolved uplinks, neighbor updates and patch expiry. Browser checks exercise the real WASM summary, collapsed message table and existing audio/listen controls. Live summary reception still needs confirmation.

**Export SDRTrunk XML** writes a new version-4 playlist containing the current/saved control frequencies, alias names/groups, and listen policy (`priority=-1` for muted IDs, `100` otherwise). Non-overlapping ranges cover otherwise unlisted IDs so the default policy survives interchange. **Import SDRTrunk XML** accepts version 3/4 playlists, lets you select a supported Phase I C4FM tuner channel, and imports aliases, ranges, and explicit mute settings. It does not import SDRTrunk's call-ranking priorities, recordings, or unrelated protocols. Original files are never modified. Export was also verified using SDRTrunk 1.0.0's actual Java playlist parser.

Control demodulation and CRC candidate selection match the Fieldglass reference receiver in `../armer/web`. `npm run test:fieldglass` compares the actual built WASM modules using identical clean/noisy CU8 at center frequencies **852.400 MHz** and **853.850 MHz**, with a **853.075 MHz** control channel. It requires identical counters and protocol events, including corrections and timestamps, after excluding the added descriptive control metadata. The optional capture comparison also exercises small/USB-sized chunks. The panel reports **recent valid blocks/second and candidate rejection percentage over approximately five seconds of RF stream time**, alongside session totals. Candidate rejection is neither BER nor the percentage of all transmitted packets lost.

USB reads are continuously replenished: each completed transfer is replaced before its IQ is dispatched, without waiting for the other transfer to complete. Results remain in request order. Hardware configuration temporarily drains the remaining reads, applies tuning/gain, resets the endpoint and decoder, and resumes. Stop drains outstanding transfers before releasing USB. Tests cover immediate refill, ordered delivery, tuning boundaries, overload, and unplugging. These transport behaviors are covered by automated tests; live reception was subsequently confirmed by the user as described below.

**Alias directory → RadioReference** optionally retrieves ARMER system 3508 aliases. RadioReference's [official API requirements](https://support.radioreference.com/hc/en-us/articles/18844460198932-Database-Web-Service-API) require an approved developer application key and a Premium account. Set `RR_APP_KEY` on the Go API (see the Docker/local API instructions above), start it, and reload. Enter your RadioReference username/password in the panel. The application key stays on the API server; credentials travel over HTTPS to RadioReference, are cleared after each request, and are not persisted. Returned aliases preserve custom/imported names and listen choices. SOAP parsing and the browser flow are tested with mocked responses; **authenticated upstream lookup has not been verified without credentials**. Static-only hosting needs the Go API behind a same-origin `/api` proxy to enable this optional lookup. Manual aliases and playlist import/export work offline.

**Try ARMER test signal** creates CU8 C4FM IQ containing CRC-valid control/site/network, neighbor/secondary channels, two band plans and TEST123 base-station ID messages, two clear groups, an encrypted grant, and an out-of-band grant. It runs through the real WASM demodulator/FEC/IMBE decoder and AudioWorklet. Its vocoder frames are test data, not intelligible speech or received traffic. Tests verify only clear enabled groups produce PCM, muted groups still appear in control events, and the exported XML round-trips the full 1–65535 policy. The 20-second RF recording from the reference project produces **41 valid / 133 rejected control candidates in both built decoders**, with identical protocol events: system **40F**, WACN **BEE07**, RFSS/site **5/75**, NAC **40C**. This old recording contains poor RF and is not a measurement of current live reception. It has no usable voice grants. Clean generated IQ at both tested center frequencies produces **48 valid / 0 rejected** over 1.25 seconds in each decoder. **Live ARMER reception and audible voice playback were confirmed by the user on November 20, 2026**, after the transport and Fieldglass-parity changes. The working settings were center **853.850 MHz**, control **853.075 MHz**, manual gain **22.9 dB**, and **0 PPM**. Reported counters were **4,447 valid / 7 rejected** (approximately **0.16%** rejected overall), with **40.0 valid blocks/s** and **0.0% rejected** in the latest five-second window. This confirms the live WebUSB → WASM P25/IMBE → browser audio path; it does not establish which individual change accounted for the improvement.

## WWV at 25 MHz

Select **Decode as… → WWV · NIST time code**. The default preset sets the hardware center to **25.050 MHz**, decoder to **25.000 MHz**, display span to **150 kHz**, and channel width to **10 kHz**. The 50 kHz hardware offset keeps the carrier away from the RTL-SDR's DC notch; it does not change the station's actual frequency. Click **Connect RTL-SDR**, then **Play audio** to hear AM ticks, tones, and announcements while the 100 Hz code decodes independently.

The digital panel displays the measured pulse duration, binary zero/one/position markers, 60-second frame, UTC date/hour/minute, day of year, DUT1, raw DST indicators, leap-second warning, and valid/rejected frame counts. It follows [NIST's digital time-code diagram and broadcast description](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code). The code starts 30 ms after each second: approximately 170 ms for zero, 470 ms for one, 770 ms for a position marker. Second zero has no 100 Hz pulse. The decoder identifies that reference gap, validates position/reserved bits and BCD/calendar ranges, then requires **two consecutive frames advancing exactly one minute** before reporting confirmation. The code has no checksum.

Allow up to about **two minutes for the first complete candidate and three for confirmation** from an arbitrary start. The timestamp is the **start of the decoded minute frame**, received near the end of that minute. It is not an extrapolated live clock. No computer time, network time, or operating-system clock changes are involved. No absolute timing/propagation calibration is claimed. The century is assumed to be 2000–2099 because the broadcast supplies two year digits. Positive/negative leap-second minute handling and deep-fade combining are not implemented; malformed frames or cadence loss cause reacquisition. DST bits are displayed without applying a local-time interpretation.

NIST's [25 MHz WWV broadcast](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv) is experimental and can be interrupted. The disabled 2.5/5/10/15/20 MHz presets are below this tuner's current 24 MHz minimum and require appropriate HF hardware or an upconverter. AM audio or a carrier alone does not establish that WWV was received. Strong broadcast-FM mixer images can still appear in the RF capture; the WWV channel filter and time-code validation are separate from the spectrum display.

**Try WWV test signal** generates a fixed, explicitly labeled 2026-11-20 test transmission in CU8 IQ. Its default **16×** mode exercises the same WASM channelizer/AM demodulator/pulse/frame decoder at accelerated stream time, with audio muted. Choose **1×** to hear generated AM audio. The source begins at second 58 of 12:33 UTC: the first complete candidate is 12:34, then 12:35 confirms it. Actual speed is CPU-limited. Synthetic provenance remains visible after stopping so a test timestamp cannot be mistaken for RF reception.

Validated: the full generated IQ path confirms the expected UTC/date/DUT1 in Chrome, AM audio plays at 1×, corrupt position markers are rejected, and noise or an unpulsed 100 Hz tone does not create a timestamp. The actual WASM also passes NIST's published example (2001/day173/21:10/+0.3), arbitrary starting phase, stream boundaries, loss of synchronization, and WFM regression checks. **Live over-the-air WWV reception has not yet been verified.**

The shared runtime `dsp_core_bg.wasm` channelizer serves WFM, AM, OOK/ASK, WWV, and rtl_433; small FIR helpers share Rust source in `wasm/src/dsp.rs`, AM and WWV additionally share the envelope detector in `wasm/src/am.rs`. WWV uses two-stage complex filtering/decimation (2.4 MSPS → 240 kHz → 48 kHz), envelope AM detection with slow carrier normalization, then quadrature 100 Hz recovery and pulse/frame validation. Its offline `process_audio()` entry accepts centered AM audio at 48 kHz for protocol tests; it does not bypass IQ processing in the app's generated-source/browser test.

## Meteor-M satellite imagery

Select **Meteor-M · LRPT satellite** in **Decode as…**. It uses the existing shared 2.4 MSPS RTL-SDR stream and the working `../meteor-m` WASM decoder, including modern OQPSK/72k/NRZ-M, legacy QPSK, frequency/Doppler correction, reacquisition, Viterbi/RS and JPEG image reconstruction. The dedicated panel displays constellation and frame/packet/FEC diagnostics, progressive grayscale channels, optional contrast, image zoom/pan/fit, and original-pixel PNG export. Use your existing V-dipole; verify downlink/mode before a pass.

**Replay recorded I/Q** streams raw CU8/CS16/CF32 or stereo IQ WAV through the same worker/plugin at the recording’s actual rate, with seek/duration and separate replay tuning. It imports Spectrum SigMF metadata and the reference app’s capture/recovery profiles, including original-time Doppler. Live settings are preserved. **Estimate frequency bias** measures the received signal during live reception or replay; with a file selected, it can start a one-shot measurement replay. **Automatically adjust frequency bias** defaults to enabled and starts when orbital Doppler correction is configured. It rejects unreliable measurements, preserves imagery/counters, and leaves the saved manual bias unchanged until explicitly applied. New Meteor IQ recordings retain transmission/orbit settings in an optional SigMF extension. **Refresh TLE** uses the optional Go API without a RadioReference key; pasted/saved elements work offline.

See [Meteor usage, modes, architecture and validation](docs/meteor.md). Public legacy and local modern recordings match the reference’s exact frame/packet counts and image hashes. Fresh over-the-air reception in this integrated app remains to be verified. Interleaved 80k is retained as experimental; the reference provides raw grayscale channels, not registered RGB composites or calibrated/georeferenced products.

## Linux USB access

If the DVB TV driver owns the USB interface, close SDR software, then run:

```sh
bash scripts/prepare-usb.sh
```

This helper temporarily unbinds only `dvb_usb_rtl28xxu` interfaces on matching Realtek receivers, using sudo. It does not blacklist a driver or install persistent configuration. Replugging may let the TV driver reclaim the device. Normal app startup does not run this helper or change permissions. Your account also needs access to the USB device (usually a distribution RTL-SDR udev rule).

## Architecture and adding a decoder

- `src/radio.ts`: WebUSB lifecycle, two continuously replenished reads, ordered configuration after draining pending transfers, and a bounded worker queue. Overload stops reception explicitly instead of silently dropping IQ continuity. Configuration revisions discard old queued results.
- `src/decoders.ts`: discoverable manifests declaring bandwidth, sample-rate requirements and typed output capabilities, plus hardware compatibility checks. Live pipelines use 2.4 MSPS CU8 input. Meteor additionally accepts recorded CU8/CS16/CF32 at supported 180 kSPS–2.4 MSPS rates.
- `src/dsp/plugins.ts`: lazy decoder factory registry, with per-decoder adapters in `src/dsp/*-plugin.ts`. These create worker-owned decoder instances with `process()` and `dispose()`. Configuration creates a fresh instance. Each returns a list of typed events; audio is optional. `src/types.ts` declares audio, protocol telemetry, time-code, and synchronization events. Meteor emits owned image patches, constellation/decoder diagnostics and lifecycle reset events. Audio specifies 48 kHz interleaved stereo, source sample position, and transfer ownership. AM emits audio alone; WWV emits AM audio and structured time-code/status; WFM emits stereo audio and pilot telemetry. ARMER emits audio, control/call messages, and receiver telemetry, with a live policy-update method that retains control synchronization.
- `src/recording/`: bounded ordered IQ writer, folder/download sinks, and SigMF metadata. While recording, the worker transfers the original input buffer back after DSP; the recorder owns it through the write. Capture IDs reject stale buffers across recordings. Normal operation does not return IQ to the main thread.
- `src/dsp/capture.worker.ts`: stable FFT, power/clipping, source sample clock and recording-buffer ownership. It transfers each CU8 buffer to the decoder worker and back without cloning it. During a new decoder download, live buffers continue through spectrum/recording without decoding; synthetic generation waits for its decoder to load.
- `src/dsp/decoder-host.ts` / `decoder.worker.ts`: disposable child worker and lazy plugin loading. Changing protocols terminates the old decoder worker, making its WASM instances, memory and JS caches eligible for reclamation, while retaining capture. Same-protocol settings changes reuse the worker but recreate native state. ARMER center-only moves and live policy changes preserve native state; NFM hold updates also retain it. Stop terminates capture and its child. Optional synthetic sources load only when requested. Browser tests observe old workers closing and ensure they do not accumulate.
- To add a decoder, add its manifest, feature-isolated native build (or external engine), plugin adapter and dynamic factory import. UI/metadata modules must not import native glue. Binary events own their buffers and never reference freed WASM memory.
- `wasm/src/wfm.rs` plus the shared core: WFM oscillator/mixer → 71-tap complex FIR and 5× decimation → 81-tap complex channel FIR and 2× decimation → phase-difference FM discriminator at 240 kHz → coherent 19 kHz pilot recovery / regenerated 38 kHz difference demodulation → matched 161-tap 15 kHz sum/difference filters and 5× decimation → 38 kHz discriminator-response correction / L/R matrix → per-channel de-emphasis/DC removal → interleaved 48 kHz stereo PCM. The pilot detector requires sufficient level and phase coherence for 80 ms, releases after 20 ms of loss, and fades separation over 40 ms. The phase relationship follows [ITU-R BS.450, §2.2](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.450-2-199510-S!!PDF-E.pdf). State persists across USB blocks; RF/filter/de-emphasis configuration changes reset it with a short muted warmup. Mono/stereo and multiplex-view changes preserve it. The optional full-rate multiplex tap sits immediately after the phase-difference discriminator and before the pilot/audio branches.
- `public/audio-worklet.js`: bounded stereo audio FIFO, 60 ms prebuffer, and independent left/right interpolation to the actual audio device sample rate. Pause/stop/configuration changes flush queued audio.
- `src/components/Spectrum.tsx`: FFT rendering and waterfall, independently cropped to the selected display span. FFT runs in the worker, with no main-thread sample processing.

The WebUSB library and receiver/worker/canvas patterns follow the local reference apps at `../armer/web` and `../meteor-m`. The WFM decoder is implemented for this project. The underlying driver API is documented at [jtarrio/webrtlsdr](https://github.com/jtarrio/webrtlsdr); Chrome's requirements are described in [Access USB Devices on the Web](https://developer.chrome.com/docs/capabilities/usb).

### WASM module boundaries

Every decoder has a separate, lazily instantiated binary; selecting an idle decoder only changes metadata and does not download WASM. Spectrum-only reception loads no WASM. The old combined `spectrum_dsp_bg.wasm` is no longer shipped.

| Selected decoder | Loaded WASM binaries | Approximate uncompressed bytes |
| --- | --- | ---: |
| None | None | 0 |
| AM | `dsp_core` + `am` | 82 KB |
| WFM + RDS/RBDS | `dsp_core` + `wfm` | 131 KB |
| NFM | `nfm` | 127 KB |
| OOK/ASK | `dsp_core` + `ook` | 150 KB |
| WWV | `dsp_core` + `wwv` | 152 KB |
| ARMER | `armer` | 364 KB |
| Meteor-M LRPT | `meteor` | 48 KB |
| rtl_433 | `dsp_core` + `rtl433` | 626 KB |

Enabling EAS/SAME additionally loads the separate `same` module (about 1.27 MB uncompressed / 424 KB gzip), shared by compatible audio receivers in that worker. It is disabled by default.

These are download sizes, not total RAM measurements. Each active instance also has linear memory and runtime state. Browser HTTP/compiled-code caches are browser-managed; terminating a worker does not promise immediate physical RAM release.

`wasm/Cargo.toml` uses isolated features to build the Rust binaries from one maintained source tree. `scripts/build-wasm.sh` enables exactly one feature per release artifact; only ARMER enables `sdr-p25`. Default features enable everything for native regression tests, never for the app's release binaries. Reusable FIR helpers share source and only required code is linked into a decoder. The high-rate FIR mixer/filter/decimator is physically shared at runtime through `dsp_core`, rather than copied into each AM/WFM/WWV/OOK binary. AM and WWV also reuse the same envelope-detector source.

Composition uses JavaScript's block-level adapter calls: CU8 2.4 MSPS enters the core, which outputs normalized F32 complex IQ at 240 kSPS, then the selected decoder emits owned PCM/events. rtl_433 uses the core's signed-16 IQ output. The core and decoder have separate linear memories, so reduced-rate baseband is copied between them; no per-sample JS calls or JSON IQ serialization occurs. This avoids allocator coupling and works with both Rust/wasm-bindgen and upstream C/Emscripten. Meteor retains its original frequency translation/FIR/RRC front end inside its C module, and normalizes input directly into a reused native float buffer. NFM's CIC/squelch pipeline and ARMER's Fieldglass-compatible multichannel CIC/FIR pipeline remain inside their respective modules to preserve their sample clocks and decoding behavior.

## Verification

```sh
npm test                 # Tuning/FFT mapping, USB lifecycle and failures, audio resampling
npm run test:api         # Go SOAP/HTTP, bounds, origin checks and credential handling
npm run test:wasm        # Native tests, isolated-module exports and actual WASM decoding
npm run test:meteor       # Actual Meteor WASM, public real IQ/pixel hashes and synthetic transport
npm run test:browser:meteor # Meteor replay, images/PNG, restart, mobile and performance
npm run test:browser:meteor-bias # Manual estimate, automatic bias, noise rejection and live controls
npm run test:browser:modules # Per-decoder runtime loading (offline precaching disabled), worker disposal
npm run test:browser:pwa # Self-hosted installability, offline cold decoders/audio, update and retry checks
npm run build            # Strict TypeScript and production build
npm run check            # Frontend/API tests, native/actual WASM checks, and production build
npm run test:browser     # WFM regression; dev or preview server must be running
npm run test:browser:multiplex # Multiplex plot, RDS, mono and playback continuity
npm run test:browser:rds       # Alias for the combined WFM/multiplex/RDS browser checks
npm run test:browser:wwv # Actual CU8 AM IQ -> WASM -> confirmed time code and AM audio
npm run test:browser:am  # Standalone AM audio, bandwidths, tuning, playback controls
npm run test:browser:recording # IQ save/metadata and saved-file offline decode
npm run test:browser:ook # OOK/ASK pulses, bits, thresholds, history and exports
npm run test:browser:ook-inspection # Edge timing, linked bits/bytes, partial captures
npm run test:browser:nfm # NFM audio/codes, parallel monitoring, scanning, history, banks
npm run test:browser:armer # P25 IQ/audio, talkgroup policies, aliases and XML interchange
npm run test:browser:armer-multi # Four simultaneous calls through WASM, worker, mixer and UI
npm run test:armer-multi  # Timestamp alignment and 1/4/8-channel WASM CPU benchmarks
npm run test:dsp-performance # Tone/noise throughput; optional DSP_BASELINE_DIR for before/after WASM
npm run test:browser:live-dsp # Vite dev server: continuously paced live input + audio under CPU throttling
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

The generated JS, declarations, and `.wasm` for each decoder and `dsp_core` in `src/wasm/` belong together and should be versioned together. Changes to Rust require rebuilding before browser tests/builds. Third-party notices and runtime license files are in `public/licenses/`.
