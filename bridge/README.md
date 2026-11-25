# Receive-only radio bridge

Run this helper on the computer connected to the SDR. It makes installed
[SoapySDR](https://github.com/pothosware/SoapySDR/wiki) receivers available to
Spectrum through a WebSocket. It is separate from the hosted Go API; no radio
samples pass through spectrumsdr.com's servers.

## Radios

| Radio family | Connection |
| --- | --- |
| RTL2832U with R820T/R828D (including Blog V3/V4 and common Nooelec devices) | Direct WebUSB in Chrome/Edge; SoapySDR is optional |
| HackRF One / compatible HackRF One firmware | Direct WebUSB in Chrome/Edge; SoapySDR is optional |
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

All current live decoders receive continuous **CU8 at 2,400,000 complex
samples/s**. RTL-SDR passes through unchanged. HackRF's signed 8-bit pairs are
converted exactly to unsigned pairs; it uses 2.4 MSPS, the 1.75 MHz receive
filter, LNA/VGA gain, and no RF amplifier or antenna power. HackRF AGC and PPM
controls are unavailable in this adapter. Blog V4 branding enables its
500 kHz–1766 MHz tuning range; the existing driver performs its HF conversion.

The bridge asks SoapySDR for CF32, chooses the lowest supported rate at or
above 2.4 MSPS (or the highest lower rate), then reads back the actual rate.
It supports native rates from 48 kSPS to 20 MSPS. A persistent
[SoXR streaming resampler](https://python-soxr.readthedocs.io/en/stable/soxr.html)
preserves filter state and sample phase across blocks and applies an anti-alias
filter when downsampling. Output is quantized to 8 bits for the current decoder
engines. **This first implementation does not preserve a high-bit-depth
receiver's full ADC dynamic range.** The receiver panel and recording metadata
identify that conversion.

Upsampling never creates additional RF bandwidth. Channels must fit inside
the native sampled band; ARMER and ADS-B currently require at least 2.4 MSPS
from the source. Spectrum coordinates refer to the normalized 2.4 MSPS stream.
IQ recordings save that normalized CU8 stream, including `spectrum:receiver`
native rate/format and hardware identity in SigMF. Hardware timestamps are not
propagated; timestamps remain approximate host receipt time.

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

`--test-signal` opens no hardware. Its NFM signal is explicitly identified as
GENERATED in the UI, filename, and recording metadata. Browser checks exercise
actual networking, capture/decoder workers, WASM audio, retuning, recording,
reconnection and mobile layout, plus a simulated HackRF WebUSB device.

The expanded RTL USB chooser IDs come from the
[Osmocom device table](https://github.com/osmocom/rtl-sdr/blob/master/src/librtlsdr.c).
HackRF requests follow the
[official libhackrf protocol](https://github.com/greatscottgadgets/hackrf/blob/main/host/libhackrf/src/hackrf.c).
