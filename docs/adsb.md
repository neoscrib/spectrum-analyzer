# 1090 MHz ADS-B / Mode S aircraft tracking

Select **Decode as… → ADS-B · 1090 MHz aircraft**. This is a local RF decoder,
not an internet flight-tracking feed. No positions come from FlightAware,
Flightradar24, or another tracking API. It supports **1090ES**, not **978 MHz UAT**,
Mode A/C-only replies, or multilateration. Reception and decoded reports are
unauthenticated and unsuitable for navigation or safety decisions.

## Receive

The selection tunes the hardware center and the fixed 1090ES channel to
**1090.000 MHz**, with **2.4 MSPS CU8** input. The 2 MHz decoder-width indicator is
independent of the displayed spectrum span. The full-rate envelope is consumed
without a second channelizer, audio path, or FFT dependency. The capture center
can move within the existing channel-fit constraint; gain and PPM remain in
**RF settings**. The decoder frequency stays at 1090 MHz.

Use an antenna suitable for 1090 MHz, with a clear view toward aircraft. A
quarter wavelength is approximately 69 mm; the antenna, ground plane, feedline,
placement and obstruction losses all affect reception. A general VHF antenna
that works for NOAA or broadcast FM may perform poorly here. Adjust the existing
manual gain while watching ADC clipping and message reception. Higher gain can
overload on strong nearby transmissions; there is no universal best gain.
No extra hardware or external decoder service is required beyond a supported
RTL-SDR and antenna.

**Try ADS-B test signal** generates six explicitly labeled synthetic aircraft.
Its actual CU8 PPM samples run through the same WASM demodulator, parity parser,
CPR resolver and registry used by live input. It never opens or transmits RF.
Gain and tuner PPM do not alter this generated source.

Hide **Spectrum & waterfall** to avoid their FFT and rendering work. Aircraft
tracking continues normally with both hidden. The existing queue-size overload
guard is unchanged; samples are not silently dropped to improve performance.

## Map and aircraft list

The map uses **Leaflet 1.9.4 and OpenStreetMap tiles**, with visible attribution.
Only tiles for the viewed area are requested using normal browser HTTP caching.
There is no bulk download, offline tile archive, proxy, background prefetch, or
external flight-data query. OSM is a network dependency, not a position source.
The app's offline cache excludes external tiles. Turn off **OpenStreetMap tiles**
to use the coordinate grid, receiver marker, aircraft and trails without internet.
Tiles can also be unavailable while decoding continues.

- Click a table address or map marker to select the same aircraft. Details show
  its fields, their ages, position method and recent raw Mode S frames.
- Aircraft rotate with fresh **ground track**. True/magnetic heading is kept as
  its own field and is not silently substituted for ground track. A dot means
  ground track is unavailable. Tooltips show identification and fresh altitude.
- Colors distinguish altitude below 10,000 ft, 10,000–25,000 ft and above
  25,000 ft. Unknown altitude uses gray. Barometric altitude is preferred when
  fresh; GNSS altitude is shown otherwise, with both sources available in details.
- **Fit aircraft** fits fresh positions plus the optional receiver. **Follow
  selected aircraft** pans as its fresh position changes. Panning/zooming never
  changes RF reception. The Web Mercator background is limited near the poles.
- **Range rings** require receiver coordinates. Distance/bearing are computed
  locally, in nautical miles and true degrees, only from a fresh position.
- Trails can be off, one, two or ten minutes. They keep at most one point per five seconds,
  and antimeridian crossings are split instead of drawing across the world.
- Column headings sort address, callsign, altitude, speed, ground track,
  distance, bearing, last reception and message count. Missing/stale fields
  remain unavailable. An aircraft identity can be displayed without a position.

Coordinates are entered manually in **Receiver location & decoder options**;
location permission is not required. A configured receiver also bounds position
solutions by the selected maximum range. Changing decoder options or RF settings
reinitializes its demodulator; stopping/retuning never joins partial messages.

## Messages, parity and correction

The pinned **dump1090-fa** core is compiled into its own lazy-loaded
`adsb.wasm` (about 57 KB). It is C/WASM using the existing decoder worker
architecture, alongside the separate Rust and C decoder modules. Other decoder
selections do not instantiate it or Leaflet. Only the built files are precached
for offline use.

The upstream 2.4 MSPS demodulator detects the standard 8 µs preamble and uses
fractional-sample correlation at five phases, rather than assuming an integer
number of samples per 1 Mbps bit. It handles 56-bit and 112-bit messages, compares
preamble signal against local noise, checks quiet intervals, scores candidate
slices and validates their parity. A fixed 320-sample tail carries complete
lookahead across arbitrary IQ buffer boundaries. Local noise comparisons adapt
to each candidate's surroundings. Reported capture power is relative dBFS, not
calibrated antenna power or a guaranteed noise-floor measurement.

Supported downlink formats:

| Format | Handling |
| --- | --- |
| DF11 | All-call / acquisition replies, capability and ICAO; PI validation with permitted low-seven-bit interrogator overlay |
| DF17 | ADS-B Extended Squitter, full CRC and ICAO |
| DF18 | Applicable non-transponder ADS-B, ADS-R and TIS-B fields; source/address conventions retained |
| DF0/4/5/16 | Common surveillance / air-air replies; address parity requires an independently established recent address |
| DF20/21 | Common Comm-B replies, altitude / squawk and supported Comm-B fields; recent-address parity gate |

The polynomial is `0xFFF409`. Zero remainder is appropriate for DF17/18, not
for all downlink formats. DF11 interrogator overlays and address parity are
handled by the upstream scorer/cache. Unknown address-parity candidates do not
create arbitrary aircraft identities. ICAO aircraft and non-ICAO/rebroadcast
identities use separate registry keys; colliding numeric addresses are not
silently merged. CPR pairs must also have matching sources.

Supported ADS-B payloads include identification/category (type codes 1–4),
surface position/movement (5–8), airborne barometric position (9–18), GNSS
position/altitude (20–22), ground velocity/airspeed/heading/vertical rate (19),
emergency and squawk (28/1), and available target/operational fields (29/31:
selected altitude, QNH, ADS-B version, NACp, IDENT). Surface movement uses the
original version's interpretation unless a recent ADS-B v2 status is available.
The raw frame and source/type/subtype are retained for unsupported payloads;
unknown semantics are not invented. Unsupported downlink formats without a
known parity convention are rejected rather than presented as verified frames.

**One-bit correction is off by default.** When enabled, DF/body repair is limited
to one bit and the resulting address must already be established by a clean
message. Damaged DF-field searches and two-bit correction are disabled. Corrected
frames are counted and labeled; both received and corrected hex remain visible.
CRC/parity is error detection, not authentication. Strong collisions may prevent
both transmissions from decoding; rejection is preferable to invented data.

## CPR and freshness

Airborne global CPR requires compatible even and odd messages within **10 source
seconds**, with matching latitude zones. It needs no receiver coordinates. A
recent aircraft position (at most **30 seconds**) can resolve a local update,
including when crossing a latitude-zone boundary. Surface pairs use a **25-second**
window and a nearby reference; they are rejected if more than **45 NM** from it.
Without a suitable reference, ambiguous surface messages remain positionless.

Single-frame **receiver-relative local CPR** is explicitly opt-in. It assumes the
transmitter lies in the receiver's ambiguity neighborhood: at most **180 NM**
for airborne local resolution and **25 NM** for surface. Configuring a larger
maximum reception range does not enlarge those local limits. A position based
on this assumption is labeled **Local CPR · receiver reference**, not global CPR.
An incorrectly configured receiver or transmitter outside that neighborhood can
produce an aliased solution; use global pairs when the assumption is uncertain.

Coordinates, receiver range, age and movement are checked before accepting a
solution. Recent-position jumps are limited to 1,200 kt plus 0.5 NM airborne,
or 150 kt plus 0.15 NM on the surface. Rejected solutions increment diagnostics
and do not replace the last accepted position. An initial global solution with
no reference cannot be checked against an unknown true receiver location.

Source sample time drives CPR and per-field freshness, so file processing speed
cannot make stale pairs current. Position, altitude, velocity and track expire
from current display after **15 seconds**; squawk uses 60 seconds, identification
and category 300 seconds, other status fields generally 30 seconds. Details keep
old field values with explicit ages/stale labels. Live display ages continue
when reception stops; completed replay uses the finite recording's clock.
UTC reception is based on the capture metadata or approximate host start time,
not a hardware timestamp. Raw replay without datetime stays source-relative.

The active list expires aircraft after **60 seconds**. Registry entries can be
reacquired for up to five minutes, then expire. Limits are **512 entries**, **12 raw
frames per aircraft**, and **120 decimated trail points / ten minutes**. Capacity
eviction removes the least-recently heard aircraft. Session snapshots can be
exported as JSON. A new radio/replay session clears the displayed registry.

## Recorded IQ

Use **Recorded IQ & SigMF replay** in the aircraft panel. Choose CU8 IQ plus
optional `.sigmf-meta`. The shared importer accepts **2.4 MSPS, one fixed-frequency
capture beginning at sample zero** and validates datatype/rate, IQ pairs, center
frequency and optional UTC datetime. Metadata supplies the capture center;
without it, the current capture center is used. Other sample formats/rates,
multicapture retunes and 978 MHz recordings are not interpreted as 1090ES.

Replay uses the existing bounded file reader, capture/decoder workers and one
transferable buffer in flight. It is paced at **1×**, supports cancellation,
and flushes the final lookahead once. It does not load the recording into memory.
Existing **IQ recording** saves the raw receiver data for later replay.

## Validation and performance

```sh
# Emscripten 7.0.0 must be on PATH to rebuild the included binary.
npm run build:adsb
npm run test:adsb
npx vitest run src/adsb
npm run test:browser:adsb       # running dev/preview; APP_URL supported
npm run test:browser:pwa       # starts its own temporary production server
LIVE_DSP_DECODERS=adsb LIVE_DSP_SECONDS=90 CPU_THROTTLE=4 npm run test:browser:live-dsp
npm run check
```

Tests include known identification/altitude/velocity vectors, DF11/17/18,
nonzero parity overlays, address-parity cache gates, correction on/off, raw
unsupported payloads, global/local/surface CPR, old/incompatible pairs, latitude
zones, range/jump rejection, field freshness, expiry/reappearance and bounded
histories. RF tests cover exact one-sample and irregular buffer splits,
fractional phases, ±250 ppm ADC clock error, weak/noisy signals, collisions, damaged frames, discontinuities
and ten minutes of dense traffic. The independent wire generator does not use
the decoder's slicing or parity code.

Native **unmodified dump1090-fa**, built separately, recovered exactly the same
**24 frames** as WASM from the same generated CU8 file. This cross-check verifies
the WASM adapter against its upstream application, not an independent new
algorithm. Its ifile reader returns a nonzero EOF exit in that revision after
printing those frames; comparison checks the received frame sequence explicitly.
Browser checks exercise RF → WASM → CPR → map/list, selection, sorting, raw
frames, mobile layout and historical SigMF replay. Automated map tests intercept
tiles and do not scrape OSM. Offline cold-start checks include ADS-B, all existing
decoders, SAME, AudioWorklet playback and IQ recording.

One desktop core run decoded **528,000 frames over 600.75 RF seconds** with
**fixed 8 MiB WASM memory**, no output drops and approximately **10.88 ms per RF
second** (about **221 MSPS**). That interval includes demodulation, native frame
serialization and JSON parsing, not map rendering or full registry tracking.
The weak fixture recovered 4/4 frames; the collision fixture recovered 2/3 without
inventing frames. Approximately 10.9 seconds of generated receiver noise produced
no accepted frames. CRC/parity cannot guarantee zero false positives on arbitrary
interference; these measurements describe these fixtures.

The continuously paced browser test includes the actual USB queue (provider
stub only), capture and decoder workers, registry, list and map overlays. With
RF plots hidden and 4× CPU throttling, a 30-second run kept pace with 2.4 MSPS,
roughly 880 messages/second and six aircraft; maximum RF backlog was zero.
The mean worker processing/RF-time ratio was **7.45%**, not total machine CPU.
A 90-second run also passed: 79,368 decoded frames, zero RF backlog and a
6.84% mean processing/RF-time ratio.
Desktop throttling does not emulate Pixel 5 hardware, thermals, USB behavior or
actual RF. Live over-the-air aircraft reception, real-world packet recovery,
phone thermals and busy-airspace conditions still require field validation.

## Provenance and references

- [dump1090-fa](https://github.com/flightaware/dump1090/tree/465e06330372ab0586a6a5063c66b60a8750f2b6), pinned at `465e06330372ab0586a6a5063c66b60a8750f2b6`, GPL-2.0-or-later with retained BSD notices.
- [readsb](https://github.com/wiedehopf/readsb) was inspected for parity/CPR/tracking policy; its GPL-3.0-or-later code is not included.
- [Junzi Sun's Mode S research reference](https://mode-s.org/1090mhz/book-the_1090mhz_riddle-junzi_sun.pdf), including the published KLM1023 / altitude / velocity vectors.
- [Leaflet 1.9.4](https://leafletjs.com/reference-1.9.4.html), BSD-2-Clause.
- [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) and [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

The complete linked upstream core source, notices, adapter and exact build recipe
are served under `public/licenses/dump1090-*`. `adsb.wasm` is an isolated optional
GPL module, following the existing C/WASM decoder pattern. No networking or
server process from dump1090 is linked into the application.
