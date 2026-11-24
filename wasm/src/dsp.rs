//! Shared DSP source. High-rate FIR channelization is exported only by dsp_core.
use std::f64::consts::PI;
pub(crate) const INPUT_RATE: f64 = 2_400_000.0;
pub(crate) const IF_RATE: f64 = 240_000.0;
pub(crate) const AUDIO_RATE: f64 = 48_000.0;

pub(crate) fn lowpass(taps: usize, cutoff: f64, rate: f64) -> Vec<f32> {
    let mut out = vec![0.0; taps];
    // Build one half and mirror it exactly: linear-phase FIRs can then fold
    // symmetric sample pairs without changing their frequency response.
    for n in 0..taps.div_ceil(2) {
        let x = n as f64 - (taps - 1) as f64 / 2.0;
        let sinc = if x == 0.0 {
            2.0 * cutoff / rate
        } else {
            (2.0 * PI * cutoff / rate * x).sin() / (PI * x)
        };
        let window = 0.42 - 0.5 * (2.0 * PI * n as f64 / (taps - 1) as f64).cos()
            + 0.08 * (4.0 * PI * n as f64 / (taps - 1) as f64).cos();
        out[n] = (sinc * window) as f32;
        out[taps - 1 - n] = out[n];
    }
    let sum: f32 = out.iter().sum();
    out.iter_mut().for_each(|v| *v /= sum);
    out
}

pub(crate) struct Fir {
    taps: Vec<f32>,
    // Mirrored ring avoids a modulo operation for every coefficient.
    ring: Vec<f32>,
    index: usize,
    symmetric: bool,
}
impl Fir {
    pub(crate) fn new(taps: Vec<f32>) -> Self {
        Self {
            symmetric: taps.iter().eq(taps.iter().rev()),
            ring: vec![0.0; taps.len() * 2],
            taps,
            index: 0,
        }
    }
    pub(crate) fn push(&mut self, value: f32) {
        self.ring[self.index] = value;
        self.ring[self.index + self.taps.len()] = value;
        self.index += 1;
        if self.index == self.taps.len() {
            self.index = 0;
        }
    }
    pub(crate) fn value(&self) -> f32 {
        let n = self.taps.len();
        let samples = &self.ring[self.index..self.index + n];
        let length = if self.symmetric { n / 2 } else { n };
        let mut sum = [0.0f32; 4];
        let mut at = 0;
        // Four independent accumulators avoid a long serial floating-point
        // dependency chain. Portable scalar WASM; no SIMD browser requirement.
        if self.symmetric {
            while at + 4 <= length {
                sum[0] += self.taps[at] * (samples[at] + samples[n - 1 - at]);
                sum[1] += self.taps[at + 1] * (samples[at + 1] + samples[n - 2 - at]);
                sum[2] += self.taps[at + 2] * (samples[at + 2] + samples[n - 3 - at]);
                sum[3] += self.taps[at + 3] * (samples[at + 3] + samples[n - 4 - at]);
                at += 4;
            }
            while at < length {
                sum[0] += self.taps[at] * (samples[at] + samples[n - 1 - at]);
                at += 1;
            }
            if n % 2 != 0 {
                sum[0] += self.taps[length] * samples[length];
            }
        } else {
            while at + 4 <= length {
                for (j, value) in sum.iter_mut().enumerate() {
                    *value += self.taps[at + j] * samples[at + j];
                }
                at += 4;
            }
            while at < length {
                sum[0] += self.taps[at] * samples[at];
                at += 1;
            }
        }
        (sum[0] + sum[1]) + (sum[2] + sum[3])
    }
}

/// Shared streaming CU8 mixer / complex FIR / integer decimator.
pub(crate) struct Downconverter {
    osc_r: f64,
    osc_i: f64,
    step_r: f64,
    step_i: f64,
    i: Fir,
    q: Fir,
    count: usize,
    oscillator_count: usize,
    decimation: usize,
}
impl Downconverter {
    pub(crate) fn new(offset: f64, cutoff: f64, taps: usize, decimation: usize) -> Self {
        let phase = -2.0 * PI * offset / INPUT_RATE;
        let filter = lowpass(taps, cutoff, INPUT_RATE);
        Self {
            osc_r: 1.0,
            osc_i: 0.0,
            step_r: phase.cos(),
            step_i: phase.sin(),
            i: Fir::new(filter.clone()),
            q: Fir::new(filter),
            count: 0,
            oscillator_count: 0,
            decimation,
        }
    }
    pub(crate) fn process(&mut self, iq: &[u8]) -> Vec<f32> {
        let mut out = Vec::with_capacity(iq.len() / self.decimation + 2);
        for pair in iq.chunks_exact(2) {
            if let Some((i, q)) = self.push(pair[0], pair[1]) {
                out.extend_from_slice(&[i, q]);
            }
        }
        out
    }
    pub(crate) fn push(&mut self, i: u8, q: u8) -> Option<(f32, f32)> {
        let i = (i as f32 - 127.5) / 128.0;
        let q = (q as f32 - 127.5) / 128.0;
        self.i.push(i * self.osc_r as f32 - q * self.osc_i as f32);
        self.q.push(i * self.osc_i as f32 + q * self.osc_r as f32);
        let next = self.osc_r * self.step_r - self.osc_i * self.step_i;
        self.osc_i = self.osc_r * self.step_i + self.osc_i * self.step_r;
        self.osc_r = next;
        // Preserve both phases without overflowing wasm32 usize on long runs.
        self.count += 1;
        self.oscillator_count += 1;
        if self.oscillator_count == 4096 {
            self.oscillator_count = 0;
            let length = self.osc_r.hypot(self.osc_i);
            self.osc_r /= length;
            self.osc_i /= length;
        }
        if self.count == self.decimation {
            self.count = 0;
            Some((self.i.value(), self.q.value()))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folded_fir_matches_reference_convolution_including_ring_wrap_and_asymmetric_taps() {
        for taps in [
            lowpass(401, 95000., INPUT_RATE),
            lowpass(161, 15000., IF_RATE),
            lowpass(63, 3200., 24000.),
            vec![0.1, 0.3, -0.2, 0.4, 0.7],
        ] {
            let mut fir = Fir::new(taps.clone());
            let mut history = vec![0.0f32; taps.len()];
            let mut seed = 123456789u32;
            for _ in 0..(taps.len() * 7) {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let x = (seed as i32) as f32 / i32::MAX as f32;
                history.rotate_left(1);
                *history.last_mut().unwrap() = x;
                fir.push(x);
                let expected: f32 = history.iter().zip(&taps).map(|(x, h)| x * h).sum();
                assert!((fir.value() - expected).abs() < 2e-6);
            }
        }
    }
}
