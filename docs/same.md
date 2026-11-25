# EAS / SAME audio decoding

Specific Area Message Encoding is an audio AFSK protocol carried by NOAA Weather
Radio and Emergency Alert System broadcasts. It is independent of AM, NFM and
WFM RF modulation. This experimental receiver is **not a substitute for a
dedicated emergency alert radio**. It makes no emergency notifications and never
changes speaker volume or automatically unmutes the receiver.

## Reception

Select AM, NFM or WFM, tune the station normally, and enable **Decode EAS/SAME**
in the **EAS / SAME** panel under the spectrum. The option is independent of the
RF decoder and may be changed during playback. **Detect attention tones** is a
separate option. SAME does not require an attention tone or stereo pilot.

For the user's NOAA reception example near **Mora, Minnesota**, try **162.425 MHz**,
**NFM**, **25 kHz** channel width and **±5 kHz** deviation. Kanabec County's
whole-county SAME code is **027065**. Nearby Mille Lacs County is **027095**.
Use the appropriate local transmitter and antenna; audible routine weather
programming does not mean SAME is being sent. Headers occur during applicable
alerts and tests. AM and commercial FM stations can carry the same audio
protocol during EAS activations.

Audio taps are independent of playback:

- NFM: normalized **24 kHz** discriminator audio, before carrier/code squelch,
  voice high-pass, de-emphasis, limiting and 48 kHz interpolation. Every enabled
  NFM virtual receiver has its own SAME state; scanning or a CTCSS/DCS filter
  cannot mute data entering that receiver's modem.
- WFM: mono sum **48 kHz** audio after its existing 15 kHz filter/decimator,
  before stereo reconstruction, de-emphasis and speaker volume. Auto stereo,
  forced mono, RDS and the 240 kHz multiplex observation path retain their normal
  behavior.
- AM: normalized **48 kHz** AM envelope before playback DC removal, warmup muting,
  scaling and limiting.

Only reduced-rate audio is copied to the separate, optional `same_bg.wasm`.
There is no second RF channelizer and no redundant audio resampler. Disabled
SAME allocates no tap buffers or modem state. A slow optional-module download
is asynchronous and leaves the existing RF/audio request queue running. Stale
loads are canceled logically when disabled/disposed. Native instances are freed
on disable or decoder replacement; workers and their cached modules are released
when the receiver stops.

## Reading the history

Each logical header shows its event description, originator, area codes and names,
issue UTC/local time, purge expiration, sender, source offset and host reception
timestamp. Live, generated, IQ replay and imported-audio sources are labeled.
Expand a row to inspect the decoded header and raw burst estimates, including
escaped carrier-loss noise bytes. Only actually received fields are parsed.

- **Single header · unconfirmed:** one complete, structurally valid header.
  It has not been corroborated by repetitions.
- **Repeated headers agree:** the modem assembled a message and at least two
  independently received complete header prefixes agree.
- **Recovered from repeated headers:** transport-layer byte/bit voting produced
  a valid header without that exact independent agreement. Original estimates
  remain available for inspection.
- **Incomplete / unverified:** malformed or incomplete data, including invalid
  timestamps or purge intervals. It is never promoted to a confirmed warning.

SAME has **no checksum or authentication**. Repetition improves error resistance;
these labels do not establish authenticity, certify an alert, or guarantee that
RF interference cannot produce incorrect data. The modem's "parity errors" are
combiner bit disagreements, not an on-air CRC or cryptographic check. Three-way
voting can be used even when all three copies agree, so a voting-byte count alone
does not mean a message required correction.

The history coalesces repeated identical headers. Later copies separated by more
than 30 seconds of source time count as retransmissions. EOM (`NNNN`) has no alert
identifier; its observation is associated with the latest header on that stream,
and its own repetition status remains visible. An EOM does not change the
header's transmitted expiration time. Separate attention-tone rows on the same
stream identify observed tone intervals; their presence is not header evidence.

History is bounded to **200 records**, with **12 recent raw estimates per record**;
only the latest 50 matching rows are rendered. Diagnostics are batched, and stable
rows are memoized. **Export SAME history** exports all retained records regardless
of the display filters. Starting a new radio/replay session clears the previous
session's history. Stopping or disabling mid-burst may leave no completed raw
estimate; the last synchronization state is diagnostic, not a completed header.

## Geographic and event filters

Enter comma-separated **six-digit SAME codes** such as `027065, 027095`, and/or
three-letter event codes such as `RWT, TOR, SVR`. These filters only affect the
list; they do not discard decoded data or prevent RF/audio processing.

`PSSCCC` consists of subdivision `P`, state/region `SS`, and county/zone `CCC`.
`P=0` covers all or an unspecified portion; `1–9` denote northwest, north,
northeast, west, central, east, southwest, south and southeast. County `000`
means the whole state/region, and `000000` means nationwide. Whole-county,
state-wide and nationwide coverage match the affected filter areas. Specific
subdivisions match the same subdivision or an all-portions filter.

County aliases are bundled from the **2020 U.S. Census county/equivalent code
snapshot** (3,235 entries); they work offline. Event/originator descriptions use
FCC/NWS tables. Unknown and newer geographic/event codes retain their original
values and are explicitly labeled. Severity/category styling is based on known
event metadata, never guessed from an unknown three-letter suffix. Unconfirmed
headers use muted borders. Marine zones without an alias retain their numeric
zone code; geographic aliases are descriptive and do not implement polygon maps.

## Time and attention signals

`TTTT` is an hours/minutes duration in 15-minute steps through one hour and
30-minute steps thereafter (through six hours for NWS-originated headers). Message expiration is **issue time + purge duration**, not
reception time + duration. Purge is message freshness, not a claim that the hazard
has ended. Day-of-year, UTC hours/minutes and purge are validated.
There is **no year on air**: the nearest valid year to the capture reference is
inferred and explicitly displayed. For historical files, set the UTC reference
or supply SigMF's capture datetime. Incorrect reference years cannot be
recovered from SAME alone. UTC/local conversions include day/year boundaries.

The optional observer looks for sustained **1050 Hz NOAA** or simultaneous
**853/960 Hz EAS** energy using 40 ms spectral windows. High spectral purity and
two seconds of persistence reject ordinary speech, music and receiver noise.
It reports a backdated start and an end after confirmed loss, with approximately
±40 ms window resolution. It recognizes tone observations, not compliance with
the standard's 8–25 second EAS attention duration. Audio containing the exact
persistent frequencies can also be observed as a tone; only headers carry alert
metadata. A last-observed-active tone without an end is not proof it continues
after decoding stops.

## Recorded audio and IQ

Expand **Recorded audio, IQ replay & generated test**:

- **Decode WAV audio:** mono/stereo PCM8/16/24/32 or float32 WAV, **8–96 kHz**.
  The worker reads 16,384-frame chunks and mixes stereo once to mono at the
  original rate. It does not load the entire file into memory or interrupt live
  radio playback. Compressed formats, RF IQ WAVs, RF64 and extensible WAV formats
  are not supported by this audio-file reader. Stop audio analysis terminates
  its worker.
- **Raw IQ:** choose an app-recorded CU8 file and optionally its SigMF metadata.
  Select the matching AM/NFM/WFM mode and recorded decoder frequency first.
  Analog replay currently supports **CU8, 2.4 MSPS, one fixed-frequency capture
  starting at sample zero**. Metadata supplies center frequency and UTC reference;
  raw files without metadata use the current center/reference. Replay uses the
  existing radio workers, streams bounded file slices at 1×, and supplies the
  corresponding demodulator's pre-mute tap. Normal Play/Pause/volume controls
  remain available. Other replay formats/rates remain Meteor-specific.
- **Decode generated SAME test audio:** a labeled synthetic weekly test with
  multiple areas, three headers, NOAA tone and EOMs. It never opens or transmits
  RF and leaves an existing receiver's playback running.

Finite-file decoding drains the modem using bounded silent tail padding so a
closely cut recording can emit buffered estimates. Padding cannot supply missing
header fields. Source offsets are decoder-relative and include filter/decision
latency; host receipt timestamps are not hardware timestamps.

## Implementation and validation

The optional Rust/WASM adapter uses pinned **sameold 0.6.0 / sameplace 0.2.0**
(MIT selected). The 0.6.0 modem is vendored with a small framing fix to
accept either permitted eighth padding-bit value; provenance and the exact
change are documented in `wasm/vendor/sameold/UPSTREAM.md`. Upstream supplies matched tone filters, AGC, timing recovery,
preamble/byte synchronization, adaptive equalization and repeated-header
assembly/voting. Attention observation, source taps, UI/history, metadata
validation and fixtures are project code. Wire framing follows 47 CFR 11.31:
16 `AB` bytes, **520.83 bit/s**, **2083.3/1562.5 Hz**, continuous **eight-bit,
LSB-first** characters. There are no conventional UART start/stop bits. The
seven-bit ASCII character is preserved; the eighth null/padding bit may be 0 or 1.

Output queues are capped at 64 events, history is bounded, and an unterminated
frame is reset after six seconds so an endless allowed-byte stream cannot grow
upstream framing buffers indefinitely. Drops/reset diagnostics are explicit.

Commands:

```sh
npm run build:wasm
npm run test:same             # actual WASM, generated audio + RF-to-audio chains
npx vitest run src/same       # metadata, dates, confidence/history/filtering
npm run test:browser:same     # running dev/preview server; APP_URL is supported
SAME_ENABLED=1 LIVE_DSP_DECODERS=wfm,am,nfm npm run test:browser:live-dsp
```

Validation includes single headers, repetitions/voting, EOM, consecutive alerts,
arbitrary buffers, unknown codes, invalid/incomplete data, multiple areas,
year boundaries, both attention tones, ordinary synthesized speech from the
bundled WAV negative control, speech-like/music/noise negatives,
noise/clipping/frequency and timing errors, six input rates and
bounded ten-minute streaming. Generated CU8 passes through actual AM/NFM/WFM
channelizers and audio taps; NFM remains muted while its SAME tap decodes.
Browser tests cover lazy loading, slow optional downloads without audio gaps,
stereo/RDS preservation, audio-file analysis, historical SigMF IQ replay,
filtering/export and mobile layout. Generated audio is also cross-checked using
the independent `multimon-ng` EAS demodulator (not linked or shipped).

No over-the-air SAME reception, actual emergency activation, or Pixel 5 SAME
performance has been claimed from these tests. Antenna/propagation, real
broadcast distortion, different encoders and real mobile thermal behavior still
require captures and field validation.

## Sources

- [FCC EAS protocol, 47 CFR 11.31](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A/part-11/subpart-B/section-11.31)
- [NWS technical reference and published vectors (2005)](https://www.weather.gov/media/directives/010_pdfs_archived/pd01017012a.pdf)
- [NWS SAME background](https://www.weather.gov/nwr/nwrsame)
- [NWS event codes and categories](https://www.weather.gov/nwr/eventcodes)
- [NWS attention signals](https://www.weather.gov/nwr/nwr_warning)
- [Census county/equivalent codes](https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt)
- [sameold source and documentation](https://github.com/cbs228/sameold)
- [Independent multimon-ng EAS demodulator](https://github.com/EliasOenal/multimon-ng)

Dependency notices are in `public/licenses/same-NOTICE.txt`. Refresh county
aliases with `python3 scripts/update-same-counties.py`; no geographic lookup API
or backend is required during reception.

A published reference vector from NWS Instruction 10-1712, Appendix A.3.2,
is included in the tests: `ZCZC-WXR-TOR-039173-039051-139069+0030-1591829-KCLE/NWS-`.
It covers Wood, Fulton and northwest Henry counties in Ohio. This is a historical
specification example, not a received warning. The maximum 31-area header is also
tested, as are both permitted padding-bit values.

One desktop benchmark measured WFM at **36.9 ms per RF second with SAME off** and
**38.2 ms with SAME on** (stereo/RDS retained): roughly **1.3 ms additional work per
RF second**. This is DSP processing time, not total machine CPU or a Pixel 5
measurement. AM/NFM increments were small and sensitive to scheduling noise.
Continuously paced browser tests exercise all three modes with audible output,
SAME enabled and RF plots hidden; the overload guard is unchanged.
At 4× browser CPU throttling, AM/NFM/WFM sustained 2.4 MSPS input; WFM also
completed two 90-second runs without overload or queue growth. Desktop browser
throttling is a stress test, not an emulation of Pixel 5 hardware or thermals.

The adapter also suppresses upstream's internally synthesized EOM on a voice-window
timeout. A real preamble/framer EOM estimate must support a reported `NNNN` message;
otherwise only the missing-EOM timeout diagnostic increments. A quiet recording
or missing end marker is never converted into a received EOM. This is covered by
a streaming test extending beyond the upstream timeout.
