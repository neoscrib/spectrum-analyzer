#!/usr/bin/env python3
"""Optional receive-only SoapySDR → Spectrum WebSocket bridge.

Run on the computer attached to the radio, not in the hosted web deployment.
SoapySDR and the radio's native module are installed separately.
"""
import argparse
import asyncio
import json
import math
import secrets
import ssl
import struct
import time
from dataclasses import dataclass

import numpy as np
import soxr

OUTPUT_RATE = 2_400_000
BLOCK = 65536


def choose_rate(rates, ranges):
    candidates = [float(r) for r in rates if 48000 <= r <= 20e6]
    for r in ranges:
        lo, hi = r.minimum(), r.maximum()
        if lo <= OUTPUT_RATE <= hi:
            candidates.append(float(OUTPUT_RATE))
        candidates.extend(v for v in (lo, hi) if 48000 <= v <= 20e6)
    if not candidates:
        raise ValueError("The driver reports no supported rate between 48 kSPS and 20 MSPS.")
    above = [r for r in candidates if r >= OUTPUT_RATE]
    return min(above) if above else max(candidates)


class Converter:
    """One persistent band-limited resampler; phase/history survive read boundaries."""
    def __init__(self, rate):
        self.resampler = None if rate == OUTPUT_RATE else soxr.ResampleStream(rate, OUTPUT_RATE, 2, dtype="float32", quality="HQ")

    def process(self, iq):
        if iq.dtype != np.float32 or iq.ndim != 2 or iq.shape[1] != 2 or not np.isfinite(iq).all():
            raise ValueError("Invalid or non-finite IQ samples.")
        output = self.resampler.resample_chunk(iq) if self.resampler else iq
        return np.clip(np.rint(output * 128 + 127.5), 0, 255).astype(np.uint8).tobytes()


def packet(data, sequence, generation):
    if not data or len(data) % 2 or len(data) > BLOCK * 2:
        raise ValueError("Invalid IQ packet size.")
    return struct.pack("<4sIII", b"SIQ1", sequence, len(data) // 2, generation) + data


def settings_checked(s, info):
    for key in ("center", "ppm"):
        if not isinstance(s.get(key), (int, float)) or not math.isfinite(s[key]):
            raise ValueError("Invalid receiver settings.")
    if not any(lo <= s["center"] <= hi for lo, hi in info["frequencyRanges"]):
        raise ValueError("Frequency is outside the receiver's tuning range.")
    gain = s.get("gain")
    limits = info["gain"]
    if gain is None:
        if not limits["auto"]:
            raise ValueError("This receiver does not support automatic gain.")
    elif not isinstance(gain, (int, float)) or not math.isfinite(gain) or not limits["min"] <= gain <= limits["max"]:
        raise ValueError("Gain is outside the receiver's supported range.")
    if abs(s["ppm"]) > 200 or (not info["ppm"] and s["ppm"] != 0):
        raise ValueError("Unsupported PPM correction.")


class SoapyReceiver:
    def __init__(self, args):
        try:
            import SoapySDR
        except ImportError as error:
            raise RuntimeError("Install the SoapySDR Python bindings and your radio's SoapySDR module on the bridge host.") from error
        self.api = SoapySDR
        self.radio = SoapySDR.Device(args)
        self.stream = None
        rx = SoapySDR.SOAPY_SDR_RX
        if self.radio.getNumChannels(rx) < 1:
            raise ValueError("Selected device has no receive channel.")
        ranges = [[r.minimum(), r.maximum()] for r in self.radio.getFrequencyRange(rx, 0)]
        if not ranges:
            raise ValueError("Driver did not report a receive frequency range.")
        gain = self.radio.getGainRange(rx, 0)
        self.rate = choose_rate(self.radio.listSampleRates(rx, 0), self.radio.getSampleRateRange(rx, 0))
        self.info = {
            "name": self.radio.getHardwareInfo().get("label", self.radio.getHardwareKey()),
            "transport": "WebSocket", "minHz": min(r[0] for r in ranges), "maxHz": max(r[1] for r in ranges), "frequencyRanges": ranges,
            "gain": {"min": gain.minimum(), "max": gain.maximum(), "step": gain.step() or 0.1, "auto": self.radio.hasGainMode(rx, 0)},
            "ppm": bool(getattr(self.radio, "hasFrequencyCorrection", lambda *_: False)(rx, 0)),
            "nativeRate": self.rate, "nativeFormat": "cf32", "sampleRate": OUTPUT_RATE, "format": "cu8",
        }

    def configure(self, settings):
        self.stop()
        settings_checked(settings, self.info)
        rx = self.api.SOAPY_SDR_RX
        self.radio.setSampleRate(rx, 0, self.rate)
        actual = self.radio.getSampleRate(rx, 0)
        if not math.isfinite(actual) or not 48000 <= actual <= 20e6:
            raise ValueError("Driver selected an unsupported sample rate.")
        self.rate = actual
        self.info["nativeRate"] = actual
        if self.info["ppm"]:
            self.radio.setFrequencyCorrection(rx, 0, settings["ppm"])
        self.radio.setFrequency(rx, 0, settings["center"])
        if self.info["gain"]["auto"]:
            self.radio.setGainMode(rx, 0, settings["gain"] is None)
        if settings["gain"] is not None:
            self.radio.setGain(rx, 0, settings["gain"])
        self.stream = self.radio.setupStream(rx, self.api.SOAPY_SDR_CF32, [0])
        result = self.radio.activateStream(self.stream)
        if result < 0:
            raise RuntimeError(f"Could not start receive stream ({result}).")
        self.read_size = min(BLOCK, max(1024, round(actual * BLOCK / OUTPUT_RATE)))
        self.buffer = np.empty(self.read_size, dtype=np.complex64)
        self.last_read = time.monotonic()

    def read(self):
        result = self.radio.readStream(self.stream, [self.buffer], self.read_size, timeoutUs=100000)
        if result.ret == self.api.SOAPY_SDR_TIMEOUT:
            if time.monotonic() - self.last_read > 3:
                raise RuntimeError("Receiver stopped delivering samples.")
            return np.empty((0, 2), dtype=np.float32)
        if result.ret <= 0 or result.ret > self.read_size or result.flags & self.api.SOAPY_SDR_END_ABRUPT:
            raise RuntimeError(f"Receiver stream lost continuity ({result.ret}); reception stopped.")
        self.last_read = time.monotonic()
        return self.buffer[:result.ret].view(np.float32).reshape(-1, 2)

    def stop(self):
        if self.stream is not None:
            try:
                self.radio.deactivateStream(self.stream)
            finally:
                self.radio.closeStream(self.stream)
                self.stream = None

    def close(self):
        self.stop()
        self.radio = None


class TestReceiver:
    """Explicit synthetic source for protocol/browser checks; never claims live RF."""
    def __init__(self, _args):
        self.info = {"name": "GENERATED NFM test source", "transport": "WebSocket", "minHz": 1, "maxHz": 6e9,
                     "frequencyRanges": [[1, 6e9]], "gain": {"min": 0, "max": 100, "step": 1, "auto": True}, "ppm": True,
                     "nativeRate": OUTPUT_RATE, "nativeFormat": "cf32", "sampleRate": OUTPUT_RATE, "format": "cu8", "generated": True}
        self.rate = OUTPUT_RATE

    def configure(self, settings):
        settings_checked(settings, self.info)
        self.sample = 0
        self.offset = 25000
        self.deadline = time.monotonic()

    def read(self):
        self.deadline += BLOCK / self.rate
        time.sleep(max(0, self.deadline - time.monotonic()))
        t = (np.arange(BLOCK, dtype=np.float64) + self.sample) / self.rate
        self.sample += BLOCK
        phase = 2 * np.pi * self.offset * t - 2.5 * np.cos(2 * np.pi * 1000 * t)
        return (np.column_stack((np.cos(phase), np.sin(phase))) * 0.3).astype(np.float32)

    def close(self):
        pass


@dataclass
class Session:
    socket: object
    receiver: object = None
    task: object = None
    running: bool = False
    generation: int = 0

    async def stop(self):
        self.running = False
        if self.task:
            await self.task
            self.task = None

    async def produce(self):
        converter = Converter(self.receiver.rate)
        sequence = 0
        pending = bytearray()
        try:
            while self.running:
                iq = await asyncio.to_thread(self.receiver.read)
                if not self.running:
                    break
                pending.extend(converter.process(iq))
                while len(pending) >= BLOCK * 2:
                    data = bytes(pending[:BLOCK * 2])
                    del pending[:BLOCK * 2]
                    await asyncio.wait_for(self.socket.send(packet(data, sequence, self.generation)), 2)
                    sequence = (sequence + 1) & 0xffffffff
        except Exception as error:
            self.running = False
            try:
                await asyncio.wait_for(self.socket.send(json.dumps({"type": "error", "error": str(error)[:500]})), 1)
            except Exception:
                pass


async def serve_client(socket, *, factory, exclusive, token, synthetic):
    session = Session(socket)
    acquired = False
    try:
        async for raw in socket:
            request = {}
            try:
                if not isinstance(raw, str):
                    raise ValueError("Commands must be JSON text.")
                request = json.loads(raw)
                if not isinstance(request, dict) or not isinstance(request.get("id"), int):
                    raise ValueError("Invalid command.")
                kind = request.get("type")
                if kind in ("list", "open") and token and not secrets.compare_digest(str(request.get("token", "")), token):
                    raise ValueError("Invalid bridge access token.")
                if kind == "list":
                    if synthetic:
                        result = [{"label": "GENERATED NFM test source", "args": "test=1"}]
                    else:
                        import SoapySDR
                        devices = await asyncio.to_thread(SoapySDR.Device.enumerate)
                        result = [{"label": d.get("label", d.get("driver", "SDR")), "args": ",".join(f"{k}={v}" for k, v in d.items() if k != "label")} for d in devices[:100]]
                elif kind == "open":
                    if session.receiver:
                        raise ValueError("Receiver already open.")
                    if exclusive.locked():
                        raise ValueError("Receiver is in use by another client.")
                    await exclusive.acquire()
                    acquired = True
                    args = request.get("args", "")
                    if not isinstance(args, str) or len(args) > 1024:
                        raise ValueError("Invalid device arguments.")
                    session.receiver = await asyncio.to_thread(factory, args)
                    result = session.receiver.info
                elif kind == "configure":
                    if not session.receiver:
                        raise ValueError("Open a receiver first.")
                    await session.stop()
                    await asyncio.to_thread(session.receiver.configure, request)
                    session.generation += 1
                    result = {"generation": session.generation, "info": session.receiver.info}
                elif kind == "close":
                    await session.stop()
                    try:
                        if session.receiver:
                            await asyncio.to_thread(session.receiver.close)
                    finally:
                        session.receiver = None
                        if acquired:
                            exclusive.release()
                            acquired = False
                    result = {}
                else:
                    raise ValueError("Unknown bridge command.")
                await socket.send(json.dumps({"type": "result", "id": request["id"], "result": result}))
                if kind == "configure":
                    session.running = True
                    session.task = asyncio.create_task(session.produce())
            except Exception as error:
                await socket.send(json.dumps({"type": "result", "id": request.get("id") if isinstance(request, dict) else None, "error": str(error)[:500]}))
    finally:
        try:
            await session.stop()
        finally:
            try:
                if session.receiver:
                    await asyncio.to_thread(session.receiver.close)
            finally:
                if acquired:
                    exclusive.release()


async def main(options):
    from websockets.asyncio.server import serve
    exclusive = asyncio.Lock()
    tls = None
    if bool(options.cert) != bool(options.key):
        raise ValueError("Supply both --cert and --key for TLS.")
    if options.cert:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(options.cert, options.key)
    if options.host not in ("127.0.0.1", "::1", "localhost") and (not options.token or not tls):
        raise ValueError("Remote binding requires --token and a TLS --cert/--key.")
    origins = options.origin or ["http://localhost:5176", "http://127.0.0.1:5176", "http://localhost:5177", "http://127.0.0.1:5177", "https://spectrumsdr.com"]
    async def handler(socket):
        await serve_client(socket, factory=TestReceiver if options.test_signal else SoapyReceiver, exclusive=exclusive, token=options.token, synthetic=options.test_signal)
    async with serve(handler, options.host, options.port, origins=origins, ssl=tls, max_size=16384, max_queue=4, write_limit=262144, compression=None):
        print(f"Spectrum RX bridge on {'wss' if tls else 'ws'}://{options.host}:{options.port}" + (" (GENERATED test signal)" if options.test_signal else ""), flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8092)
    parser.add_argument("--origin", action="append", help="Allowed app Origin; repeat to allow more than one")
    parser.add_argument("--token", default="")
    parser.add_argument("--cert")
    parser.add_argument("--key")
    parser.add_argument("--test-signal", action="store_true", help="Generate NFM IQ without opening hardware")
    try:
        asyncio.run(main(parser.parse_args()))
    except KeyboardInterrupt:
        pass
