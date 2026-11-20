//! Shared streaming AM channelizer and envelope detector, also used by WWV.
use super::{Downconverter, Fir, IF_RATE, lowpass};
use wasm_bindgen::prelude::*;

pub(crate) struct AmDemodulator {
    front: Downconverter,
    i: Fir,
    q: Fir,
    count: usize,
    carrier: f32,
    audio_input: f32,
    audio_output: f32,
    warmup: usize,
}
impl AmDemodulator {
    pub(crate) fn new(offset_hz: f64, bandwidth_hz: f64) -> Self {
        let taps = lowpass(
            161,
            (bandwidth_hz / 2.0 - 800.0).clamp(2200.0, 7200.0),
            IF_RATE,
        );
        Self {
            front: Downconverter::new(offset_hz, 90_000.0, 121, 10),
            i: Fir::new(taps.clone()),
            q: Fir::new(taps),
            count: 0,
            carrier: 0.1,
            audio_input: 0.0,
            audio_output: 0.0,
            warmup: 960,
        }
    }
    pub(crate) fn process(&mut self, iq: &[u8], mut on_am: impl FnMut(f32)) -> Vec<f32> {
        let mut audio = Vec::with_capacity(iq.len() / 50 + 2);
        for pair in iq.chunks_exact(2) {
            if let Some((i, q)) = self.front.push(pair[0], pair[1]) {
                self.i.push(i);
                self.q.push(q);
                self.count += 1;
                if self.count % 5 != 0 {
                    continue;
                }
                let amplitude = self.i.value().hypot(self.q.value());
                // Slow carrier normalization removes DC and levels RF gain/fading.
                self.carrier += 0.00008332986 * (amplitude - self.carrier);
                let am = (amplitude / self.carrier.max(0.003) - 1.0).clamp(-3.0, 3.0);
                on_am(am);
                // Remove residual carrier/AGC DC from playback (~20 Hz), while
                // WWV receives the original normalized AM above this stage.
                let ac = am - self.audio_input + 0.99738544 * self.audio_output;
                self.audio_input = am;
                self.audio_output = ac;
                let sample = if self.warmup > 0 {
                    self.warmup -= 1;
                    0.0
                } else {
                    (ac * 0.6).clamp(-1.0, 1.0)
                };
                audio.push(sample);
                audio.push(sample);
            }
        }
        audio
    }
}

#[wasm_bindgen]
pub struct AmDecoder {
    demodulator: AmDemodulator,
}
#[wasm_bindgen]
impl AmDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(offset_hz: f64, bandwidth_hz: f64) -> Self {
        Self {
            demodulator: AmDemodulator::new(offset_hz, bandwidth_hz),
        }
    }
    /// 2.4 MSPS CU8 -> 48 kHz mono audio duplicated into interleaved L/R.
    pub fn process(&mut self, iq: &[u8]) -> Vec<f32> {
        self.demodulator.process(iq, |_| {})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;
    fn fixture(offset: f64, hz: f64, adjacent: bool) -> Vec<u8> {
        let mut iq = Vec::with_capacity(1_920_000);
        for n in 0..960000 {
            let t = n as f64 / 2_400_000.0;
            let a = 50.0 * (1.0 + 0.6 * (2.0 * PI * hz * t).sin());
            let p = 2.0 * PI * offset * t;
            let b = if adjacent {
                20.0 * (1.0 + 0.4 * (2.0 * PI * 3000.0 * t).sin())
            } else {
                0.0
            };
            let q = 2.0 * PI * (offset + 40000.0) * t;
            iq.push((127.5 + a * p.cos() + b * q.cos()).round() as u8);
            iq.push((127.5 + a * p.sin() + b * q.sin()).round() as u8);
        }
        iq
    }
    fn tone(audio: &[f32], hz: f64) -> f64 {
        let stable: Vec<f64> = audio
            .iter()
            .step_by(2)
            .skip(14400)
            .map(|s| *s as f64)
            .collect();
        let (mut re, mut im) = (0.0, 0.0);
        for (n, v) in stable.iter().enumerate() {
            let p = 2.0 * PI * hz * n as f64 / 48000.0;
            re += v * p.cos();
            im += v * p.sin();
        }
        2.0 * re.hypot(im) / stable.len() as f64
    }
    #[test]
    fn recovers_am_at_both_offset_signs_and_rejects_neighbor() {
        for offset in [-475000.0, 375000.0] {
            let audio = AmDecoder::new(offset, 10000.0).process(&fixture(offset, 1000.0, true));
            assert_eq!(audio.len(), 38400);
            assert!(
                audio
                    .chunks_exact(2)
                    .all(|c| c[0] == c[1] && c[0].is_finite())
            );
            assert!(tone(&audio, 1000.0) > 0.3);
            assert!(tone(&audio, 3000.0) < 0.005);
        }
    }
    #[test]
    fn channel_width_changes_audio_passband_and_chunks_preserve_state() {
        let iq = fixture(100000.0, 5500.0, false);
        let wide = AmDecoder::new(100000.0, 16000.0).process(&iq);
        let narrow = AmDecoder::new(100000.0, 6000.0).process(&iq);
        assert!(tone(&wide, 5500.0) > 0.25);
        assert!(tone(&narrow, 5500.0) < tone(&wide, 5500.0) * 0.1);
        let mut decoder = AmDecoder::new(100000.0, 16000.0);
        let chunks: Vec<f32> = iq.chunks(12346).flat_map(|b| decoder.process(b)).collect();
        assert_eq!(wide, chunks);
    }
}
