# Receive-only radio bridge

Run this helper on the computer connected to the SDR. It makes installed
[SoapySDR](https://github.com/pothosware/SoapySDR/wiki) receivers available to
Spectrum through a WebSocket. It is separate from the hosted Go API; no radio
samples pass through spectrumsdr.com's servers.

## Radios

| Radio family | Connection |
| --- | --- |
| RTL2832U with R820T/R828D (including Blog V3/V4 and common Nooelec devices) | Direct WebUSB in Chrome/Edge; SoapySDR is optional |
| HackRF One / HackRF Pro (standard 8-bit mode) | Direct WebUSB in Chrome/Edge; SoapySDR is optional |
| Airspy R2 / Mini | [SoapyAirspy](https://github.com/pothosware/SoapyAirspy) + libairspy |
| Airspy HF+ / Discovery | [SoapyAirspyHF](https://github.com/pothosware/SoapyAirspyHF) + libairspyhf |
| SDRplay RSP family | [SoapySDRPlay3](https://github.com/pothosware/SoapySDRPlay3) + the vendor's SDRplay API |
| LimeSDR USB / Mini | [LimeSuite](https://github.com/myriadrf/LimeSuite)'s SoapySDR module |
| bladeRF | [SoapyBladeRF](https://github.com/pothosware/SoapyBladeRF) + libbladeRF |
| Ettus USRP | [SoapyUHD](https://github.com/pothosware/SoapyUHD) + UHD |
| ADALM-Pluto | [SoapyPlutoSDR](https://github.com/pothosware/SoapyPlutoSDR) + libiio |
| Other SoapySDR receive devices | Available when their driver supplies CF32 RX, rate, tuning and gain capabilities |

These bridge families use the same adapter and native driver capabilities;
they have **not each been tested on physical hardware**. Direct HackRF control
and conversion have protocol and simulated-browser tests, rather than a
physical HackRF validation. Existing RTL-SDR capture regression tests remain.
Devices with other RTL tuner chips can use the native SoapyRTLSDR module.

## Install and run

Install SoapySDR, its Python bindings, and the module/native SDK for your radio
using the instructions in the relevant project above. On Debian/Ubuntu, the
base packages are `soapysdr-tools` and `python3-soapysdr`; receiver modules are
separate packages or vendor installations. Confirm discovery first:

```sh
SoapySDRUtil --find
SoapySDRUtil --probe="driver=airspy"
```

Use the system Python that matches the installed SoapySDR bindings. From the
Spectrum repository:

```sh
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r bridge/requirements.txt
.venv/bin/python bridge/sdr_bridge.py
```

Select **Radio source → SoapySDR · bridge**, enter `ws://127.0.0.1:8092`, and
click **Find bridge receivers**. Choose the discovered receiver, set frequency
and gain, and connect. Device arguments may also be entered manually, such as
`driver=airspy`; include a serial number when selecting among multiple radios.
The bridge uses receive channel 0 and the driver's default antenna selection.
Only one client can own a receiver at a time.

### HTTPS and network use

An HTTPS app needs a browser-trusted `wss://` endpoint. Run with a certificate
valid for the bridge's hostname and use the matching URL in Spectrum:

```sh
.venv/bin/python bridge/sdr_bridge.py --cert bridge.pem --key bridge-key.pem
```

By default the helper binds only to loopback and accepts Origins for
`http://localhost:5176`, `http://127.0.0.1:5176`, their port-5177 preview
equivalents, and `https://spectrumsdr.com`. Use repeated `--origin` arguments
for another app origin. Remote binding additionally requires TLS and a token:

```sh
.venv/bin/python bridge/sdr_bridge.py --host 0.0.0.0 \
  --cert bridge.pem --key bridge-key.pem --token YOUR_TOKEN \
  --origin https://spectrumsdr.com
```

Enter the token under **Bridge authentication**. The browser does not persist
the token with source preferences. The helper never opens transmit streams.

## Sample contract and limits

Choose **Capture rate** while the receiver is stopped. RTL-SDR retains its
stable 2.4 MSPS setting. HackRF One/Pro offer 2.4, 4, 6, 8, 10, 12, 16 and
20 MSPS. The SoapySDR bridge advertises rates supported by its driver and
conversion path. Wideband selection switches an incompatible decoder to
**None · spectrum only**; the UI explains each decoder's rate requirements.
The current audio, rtl_433, OOK, ARMER and ADS-B engines use 2.4 MSPS; Meteor
supports its existing replay rates up to 2.4 MSPS. Higher-rate capture does not
silently run these decoders on an incorrectly labeled stream.

**Spectrum and IQ recording retain the selected capture rate, up to 20 MSPS.**
The FFT axis uses that actual rate, display span can cover the full captured
band, and recording duration, sizes, filenames and SigMF use the same sample
clock. At 20 MSPS, CU8 produces **40 MB/s (2.4 GB/min)**; folder streaming avoids
the 64 MiB download-mode limit. **Spectrum IQ replay** accepts CU8/SigMF files
at their recorded rate. Data queues remain bounded and an overload stops
reception instead of silently losing samples.

RTL-SDR passes through unchanged. HackRF's signed 8-bit pairs are converted
exactly to unsigned pairs; its sample-clock command and receive filter follow
the selected rate (15 MHz filter at 20 MSPS). Board identity distinguishes
HackRF Pro, enables its 100 kHz tuning floor, and disables its narrowband
receive filter. This adapter uses ordinary 8-bit I/Q, rather than Pro's
extended-precision or packed half-precision FPGA modes. RF amplifier and
antenna power remain off. HackRF AGC and PPM controls are unavailable.
Blog V4 branding enables its 500 kHz–1766 MHz range; the existing driver
performs its HF conversion.

The bridge asks SoapySDR for CF32 at a native rate at or above the requested
capture rate, then reads back the actual rate. When required, a persistent
[SoXR streaming resampler](https://python-soxr.readthedocs.io/en/stable/soxr.html)
converts to the **requested rate**, not a fixed 2.4 MSPS. Upsampling narrow
hardware to the default 2.4 MSPS remains available for the existing decoders;
requests for higher wideband capture are rejected if the hardware cannot
supply that bandwidth. Device overruns and non-finite input are errors.
Output remains quantized to 8 bits; **higher ADC precision is not preserved
in this initial implementation**. Native format/rate and conversion details
remain visible and are retained in the optional `spectrum:receiver` SigMF
extension. Antenna power follows the native driver's settings and is not
controlled by the bridge.

This is groundwork for a future wideband decoder such as ATSC 1.0, whose
[A/53 transmission standard](https://www.atsc.org/atsc-documents/a53-atsc-digital-television-standard/)
uses a 6 MHz channel. **ATSC demodulation, transport stream decoding and media
playback remain future work.** A decoder module can declare a wideband rate
requirement and receive the full-rate stream without the old conversion limit.
Hardware timestamps are not propagated; timestamps remain approximate host
receipt time.

The bridge sends fixed 65,536-sample blocks with a sequence and retune
generation. Device overruns, abrupt endings, sequence gaps and full browser
queues stop reception rather than silently dropping samples. Retuning ends
the previous stream, resets conversion state, and starts a new generation.
Client disconnects release the receiver. USB devices without hardware sample
counters still cannot prove that every ADC sample reached the host.

## Development checks

```sh
.venv/bin/python -m unittest discover -s bridge -v
.venv/bin/python bridge/sdr_bridge.py --test-signal --port 18092
# In another terminal, with Vite running:
npm run test:browser:sources
```

`--test-signal` opens no hardware. Its NFM signal (or two widely separated tones at higher rates) is explicitly identified as
GENERATED in the UI, filename, and recording metadata. Browser checks exercise
actual networking, capture/decoder workers, WASM audio, retuning, recording,
reconnection and mobile layout, plus a simulated HackRF WebUSB device.

The expanded RTL USB chooser IDs come from the
[Osmocom device table](https://github.com/osmocom/rtl-sdr/blob/master/src/librtlsdr.c).
HackRF requests follow the
[official libhackrf protocol](https://github.com/greatscottgadgets/hackrf/blob/main/host/libhackrf/src/hackrf.c).

`npm run test:browser:high-rate` checks simulated HackRF Pro at 20 MSPS, tones at ±6 MHz, an 80 MB / two-second recording, full-rate replay, and the actual local WebSocket bridge at 20 MSPS. It uses generated IQ and does not claim physical HackRF Pro validation.
