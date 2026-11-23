//! Shared CU8 channel selection for external protocol engines.
use super::Downconverter;
use wasm_bindgen::prelude::*;

/// Shared runtime DDC. All calls process blocks; no per-sample JS callbacks.
#[wasm_bindgen]
pub struct Channelizer {
    front: Downconverter,
}
#[wasm_bindgen]
impl Channelizer {
    #[wasm_bindgen(constructor)]
    pub fn new(offset: f64, cutoff: f64, taps: usize, decimation: usize) -> Result<Self, JsValue> {
        if !offset.is_finite()
            || !cutoff.is_finite()
            || cutoff <= 0.0
            || cutoff >= 1_200_000.0
            || !(3..=4097).contains(&taps)
            || taps % 2 == 0
            || !(1..=1024).contains(&decimation)
        {
            return Err(JsValue::from_str("Invalid channelizer configuration"));
        }
        Ok(Self {
            front: Downconverter::new(offset, cutoff, taps, decimation),
        })
    }
    /// CU8 2.4 MSPS -> owned interleaved normalized F32 I/Q at 2.4M / decimation.
    pub fn process(&mut self, iq: &[u8]) -> Vec<f32> {
        self.front.process(iq)
    }
}

#[wasm_bindgen]
pub struct IqChannelizer {
    front: Downconverter,
}
#[wasm_bindgen]
impl IqChannelizer {
    #[wasm_bindgen(constructor)]
    pub fn new(offset_hz: f64, bandwidth_hz: f64) -> Self {
        Self {
            front: Downconverter::new(
                offset_hz,
                (bandwidth_hz.clamp(50000.0, 200000.0) / 2.0 - 5000.0).max(20000.0),
                401,
                10,
            ),
        }
    }
    /// 2.4 MSPS CU8 -> 240 kSPS interleaved signed 16-bit I/Q.
    pub fn process(&mut self, iq: &[u8]) -> Vec<i16> {
        let mut out = Vec::with_capacity(iq.len() / 10 + 2);
        for pair in iq.chunks_exact(2) {
            if let Some((i, q)) = self.front.push(pair[0], pair[1]) {
                out.push((i * 32768.0).round().clamp(-32768.0, 32767.0) as i16);
                out.push((q * 32768.0).round().clamp(-32768.0, 32767.0) as i16);
            }
        }
        out
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn iq_offsets_and_chunks_preserve_phase_and_rate() {
        for offset in [-475000.0, 375000.0] {
            let iq: Vec<u8> = (0..240000)
                .flat_map(|n| {
                    let p = 2.0 * std::f64::consts::PI * (offset + 12000.0) * n as f64 / 2400000.0;
                    [
                        (127.5 + 50.0 * p.cos()).round() as u8,
                        (127.5 + 50.0 * p.sin()).round() as u8,
                    ]
                })
                .collect();
            let whole = IqChannelizer::new(offset, 100000.0).process(&iq);
            let mut stream = IqChannelizer::new(offset, 100000.0);
            let parts: Vec<i16> = iq.chunks(12346).flat_map(|b| stream.process(b)).collect();
            assert_eq!(whole, parts);
            assert_eq!(whole.len(), 48000);
            let pairs: Vec<_> = whole.chunks_exact(2).skip(200).collect();
            let mut phase = 0.0f64;
            for p in pairs.windows(2) {
                let (i, q) = (p[0][0] as f64, p[0][1] as f64);
                let (a, b) = (p[1][0] as f64, p[1][1] as f64);
                phase += (b * i - a * q).atan2(a * i + b * q);
            }
            let frequency =
                phase / (pairs.len() - 1) as f64 * 240000.0 / (2.0 * std::f64::consts::PI);
            assert!((frequency - 12000.0).abs() < 2.0);
        }
    }
}
