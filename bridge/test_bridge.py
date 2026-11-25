import struct
import asyncio
import json
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np
from sdr_bridge import BLOCK, OUTPUT_RATE, Converter, SoapyReceiver, TestReceiver, choose_rate, packet, serve_client


class Range:
    def __init__(self, low, high, step=0):
        self.low, self.high, self.increment = low, high, step

    def minimum(self): return self.low
    def maximum(self): return self.high
    def step(self): return self.increment


class BridgeTests(unittest.TestCase):
    def test_rate_negotiation(self):
        self.assertEqual(choose_rate([6e6, 3e6], []), 3e6)
        self.assertEqual(choose_rate([192000, 768000], []), 768000)
        self.assertEqual(choose_rate([], [Range(1e6, 10e6)]), OUTPUT_RATE)
        with self.assertRaises(ValueError): choose_rate([30e6], [])

    def test_streaming_conversion_is_independent_of_chunk_boundaries(self):
        rate = 6e6
        t = np.arange(300000) / rate
        iq = (np.column_stack((np.cos(2*np.pi*123456*t), np.sin(2*np.pi*123456*t))) * 0.6).astype(np.float32)
        whole = Converter(rate).process(iq)
        converter = Converter(rate)
        parts = b"".join(converter.process(iq[n:n+7291]) for n in range(0, len(iq), 7291))
        a, b = np.frombuffer(whole, np.uint8), np.frombuffer(parts, np.uint8)
        count = min(len(a), len(b))
        self.assertGreater(count, 200000)
        self.assertLessEqual(np.max(np.abs(a[:count].astype(int) - b[:count].astype(int))), 1)

    def test_antialias_filter_rejects_out_of_band_tone(self):
        t = np.arange(300000) / 6e6
        def tone(hz):
            iq = (np.column_stack((np.cos(2*np.pi*hz*t), np.sin(2*np.pi*hz*t))) * 0.6).astype(np.float32)
            return np.frombuffer(Converter(6e6).process(iq), np.uint8).astype(float)[-65536:] - 127.5
        inside, outside = tone(100000), tone(1500000)
        self.assertGreater(np.std(inside), 40)
        self.assertLess(np.std(outside), 1)

    def test_native_rate_conversion_and_invalid_samples(self):
        self.assertEqual(Converter(OUTPUT_RATE).process(np.array([[-1, 0], [1, 0.5]], dtype=np.float32)), bytes([0, 128, 255, 192]))
        with self.assertRaises(ValueError): Converter(OUTPUT_RATE).process(np.array([[float("nan"), 0]], dtype=np.float32))

    def test_packet_carries_sample_count_generation_and_sequence(self):
        block = packet(bytes([1, 2, 3, 4]), 7, 12)
        self.assertEqual(struct.unpack("<4sIII", block[:16]), (b"SIQ1", 7, 2, 12))
        for bad in (b"", b"123", bytes(BLOCK*2+2)):
            with self.assertRaises(ValueError): packet(bad, 0, 1)

    def test_soapy_lifecycle_uses_receive_channel_and_reports_actual_rate(self):
        class Radio:
            def __init__(self): self.calls = []
            def getNumChannels(self, direction): return 1
            def getFrequencyRange(self, direction, channel): return [Range(1e6, 6e9)]
            def getGainRange(self, direction, channel): return Range(0, 60, 1)
            def listSampleRates(self, direction, channel): return [6e6]
            def getSampleRateRange(self, direction, channel): return []
            def getHardwareKey(self): return "fake-airspy"
            def getHardwareInfo(self): return {}
            def hasGainMode(self, direction, channel): return False
            def hasFrequencyCorrection(self, direction, channel): return False
            def setSampleRate(self, *args): self.calls.append(("rate", *args))
            def getSampleRate(self, *args): return 6000000.1
            def setFrequency(self, *args): self.calls.append(("frequency", *args))
            def setGain(self, *args): self.calls.append(("gain", *args))
            def setupStream(self, *args): self.calls.append(("stream", *args)); return "stream"
            def activateStream(self, *args): return 0
            def deactivateStream(self, *args): self.calls.append(("deactivate",))
            def closeStream(self, *args): self.calls.append(("close",))
            def readStream(self, stream, buffers, count, **kwargs):
                buffers[0][:4] = 0.25 + 0.5j
                return types.SimpleNamespace(ret=4, flags=0)
        radio = Radio()
        api = types.SimpleNamespace(Device=lambda _: radio, SOAPY_SDR_RX=0, SOAPY_SDR_CF32="CF32", SOAPY_SDR_TIMEOUT=-1, SOAPY_SDR_END_ABRUPT=8)
        with patch.dict(sys.modules, {"SoapySDR": api}):
            receiver = SoapyReceiver("driver=airspy")
            receiver.configure({"center": 100e6, "gain": 25, "ppm": 0})
            self.assertEqual(receiver.info["nativeRate"], 6000000.1)
            self.assertIn(("stream", 0, "CF32", [0]), radio.calls)
            np.testing.assert_equal(receiver.read(), np.array([[0.25, 0.5]]*4, dtype=np.float32))
            radio.readStream = lambda *args, **kwargs: types.SimpleNamespace(ret=-4, flags=0)
            with self.assertRaisesRegex(RuntimeError, "continuity"): receiver.read()
            receiver.close()
            self.assertEqual(radio.calls[-2:], [("deactivate",), ("close",)])


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from websockets.asyncio.server import serve
        self.lock = asyncio.Lock()
        async def handler(socket):
            await serve_client(socket, factory=TestReceiver, exclusive=self.lock, token="test-token", synthetic=True)
        self.server = await serve(handler, "127.0.0.1", 0, origins=["http://localhost:5176"], compression=None)
        self.url = f"ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()

    async def test_origin_rejection(self):
        from websockets.asyncio.client import connect
        from websockets.exceptions import InvalidStatus
        with self.assertRaises(InvalidStatus):
            async with connect(self.url, origin="https://unrelated.example"):
                pass

    async def test_explicit_close_releases_receiver_before_acknowledging(self):
        from websockets.asyncio.client import connect
        async with connect(self.url, origin="http://localhost:5176") as socket:
            await socket.send(json.dumps({"id": 1, "type": "open", "token": "test-token"}))
            self.assertIn("result", json.loads(await socket.recv()))
            self.assertTrue(self.lock.locked())
            await socket.send(json.dumps({"id": 2, "type": "close"}))
            self.assertEqual(json.loads(await socket.recv())["id"], 2)
            self.assertFalse(self.lock.locked())

    async def test_auth_exclusive_use_retuning_and_cleanup(self):
        from websockets.asyncio.client import connect
        async with connect(self.url, origin="http://localhost:5176") as first:
            await first.send(json.dumps({"id": 1, "type": "open"}))
            self.assertIn("token", json.loads(await first.recv())["error"])
            await first.send(json.dumps({"id": 2, "type": "open", "token": "test-token"}))
            self.assertTrue(json.loads(await first.recv())["result"]["generated"])
            async with connect(self.url, origin="http://localhost:5176") as second:
                await second.send(json.dumps({"id": 1, "type": "open", "token": "test-token"}))
                self.assertIn("in use", json.loads(await second.recv())["error"])
                for generation in (1, 2):
                    await first.send(json.dumps({"id": generation + 2, "type": "configure", "center": 462400000 + generation*100000, "gain": 20, "ppm": 0}))
                    while True:
                        response = await asyncio.wait_for(first.recv(), 2)
                        if isinstance(response, str): break
                    self.assertEqual(json.loads(response)["result"]["generation"], generation)
                    frame = await asyncio.wait_for(first.recv(), 2)
                    self.assertEqual(struct.unpack("<4sIII", frame[:16]), (b"SIQ1", 0, BLOCK, generation))
                await first.close()
                for _ in range(100):
                    if not self.lock.locked(): break
                    await asyncio.sleep(0.01)
                self.assertFalse(self.lock.locked())
                await second.send(json.dumps({"id": 2, "type": "open", "token": "test-token"}))
                self.assertIn("result", json.loads(await second.recv()))


if __name__ == "__main__": unittest.main()
