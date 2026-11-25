//! Shared DSP source. High-rate FIR channelization is exported only by dsp_core.
use std::f64::consts::PI;
pub(crate) const INPUT_RATE: f64 = 2_400_000.0;
pub(crate) const IF_RATE: f64 = 240_000.0;
pub(crate) const AUDIO_RATE: f64 = 48_000.0;

pub(crate) fn lowpass(taps: usize, cutoff: f64, rate: f64) -> Vec<f32> {
    lowpass_windowed(taps, cutoff, rate, |phase| {
        0.42 - 0.5 * phase.cos() + 0.08 * (2.0 * phase).cos()
    })
}

fn lowpass_windowed(taps: usize, cutoff: f64, rate: f64, window: impl Fn(f64) -> f64) -> Vec<f32> {
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
        out[n] = (sinc * window(2.0 * PI * n as f64 / (taps - 1) as f64)) as f32;
        out[taps - 1 - n] = out[n];
    }
    let sum: f32 = out.iter().sum();
    out.iter_mut().for_each(|v| *v /= sum);
    out
}

/// Broad anti-alias stage for 5:1 decimation, flat through 0.04375 * rate.
/// Four-term Blackman-Harris gives >100 dB rejection from 0.15625 * rate.
pub(crate) fn decimate_five_taps(rate: f64) -> Vec<f32> {
    lowpass_windowed(71, rate / 10.0, rate, |phase| {
        0.35875 - 0.48829 * phase.cos() + 0.14128 * (2.0 * phase).cos()
            - 0.01168 * (3.0 * phase).cos()
    })
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
        // Four independent accumulators avoid a long serial floating-point
        // dependency chain. Fixed-size chunks also let WASM omit per-tap
        // bounds checks. Portable scalar WASM; no SIMD browser requirement.
        let (coefficients, coefficient_tail) = self.taps[..length].as_chunks::<4>();
        let (left, left_tail) = samples[..length].as_chunks::<4>();
        if self.symmetric {
            let (right_tail, right) = samples[n - length..].as_rchunks::<4>();
            for ((h, a), b) in coefficients.iter().zip(left).zip(right.iter().rev()) {
                sum[0] += h[0] * (a[0] + b[3]);
                sum[1] += h[1] * (a[1] + b[2]);
                sum[2] += h[2] * (a[2] + b[1]);
                sum[3] += h[3] * (a[3] + b[0]);
            }
            for ((h, a), b) in coefficient_tail
                .iter()
                .zip(left_tail)
                .zip(right_tail.iter().rev())
            {
                sum[0] += h * (a + b);
            }
            if n % 2 != 0 {
                sum[0] += self.taps[length] * samples[length];
            }
        } else {
            for (h, a) in coefficients.iter().zip(left) {
                for j in 0..4 {
                    sum[j] += h[j] * a[j];
                }
            }
            for (h, a) in coefficient_tail.iter().zip(left_tail) {
                sum[0] += h * a;
            }
        }
        (sum[0] + sum[1]) + (sum[2] + sum[3])
    }
}

/// Paired I/Q convolution shares coefficient loads and ring bookkeeping.
/// All complex filters here use exactly symmetric, generated low-pass taps.
struct ComplexFir {
    taps: Vec<f32>,
    ring: Vec<[f32; 2]>,
    index: usize,
}
impl ComplexFir {
    fn new(taps: Vec<f32>) -> Self {
        assert!(taps.iter().eq(taps.iter().rev()));
        Self {
            ring: vec![[0.0; 2]; taps.len() * 2],
            taps,
            index: 0,
        }
    }
    fn push(&mut self, i: f32, q: f32) {
        self.ring[self.index] = [i, q];
        self.ring[self.index + self.taps.len()] = [i, q];
        self.index += 1;
        if self.index == self.taps.len() {
            self.index = 0;
        }
    }
    fn value(&self) -> (f32, f32) {
        let n = self.taps.len();
        let half = n / 2;
        let samples = &self.ring[self.index..self.index + n];
        let (coefficients, tail) = self.taps[..half].as_chunks::<4>();
        let (left, left_tail) = samples[..half].as_chunks::<4>();
        let (right_tail, right) = samples[n - half..].as_rchunks::<4>();
        let mut sum = [[0.0f32; 2]; 4];
        for ((h, a), b) in coefficients.iter().zip(left).zip(right.iter().rev()) {
            for j in 0..4 {
                for ch in 0..2 {
                    sum[j][ch] += h[j] * (a[j][ch] + b[3 - j][ch]);
                }
            }
        }
        for ((h, a), b) in tail.iter().zip(left_tail).zip(right_tail.iter().rev()) {
            for ch in 0..2 {
                sum[0][ch] += h * (a[ch] + b[ch]);
            }
        }
        if n % 2 != 0 {
            for ch in 0..2 {
                sum[0][ch] += self.taps[half] * samples[half][ch];
            }
        }
        (
            (sum[0][0] + sum[1][0]) + (sum[2][0] + sum[3][0]),
            (sum[0][1] + sum[1][1]) + (sum[2][1] + sum[3][1]),
        )
    }
}

/// Shared streaming CU8 mixer / complex FIR / integer decimator.
pub(crate) struct Downconverter {
    osc_r: f64,
    osc_i: f64,
    step_r: f64,
    step_i: f64,
    filter: ComplexFir,
    count: usize,
    oscillator_count: usize,
    decimation: usize,
}

pub(crate) struct ComplexDecimator {
    filter: ComplexFir,
    count: usize,
    decimation: usize,
}
impl ComplexDecimator {
    pub(crate) fn new(taps: Vec<f32>, decimation: usize) -> Self {
        Self {
            filter: ComplexFir::new(taps),
            count: 0,
            decimation,
        }
    }
    pub(crate) fn push(&mut self, i: f32, q: f32) -> Option<(f32, f32)> {
        self.filter.push(i, q);
        self.count += 1;
        if self.count != self.decimation {
            return None;
        }
        self.count = 0;
        Some(self.filter.value())
    }
}

pub(crate) struct WfmDownconverter {
    first: Downconverter,
    second: ComplexDecimator,
}
impl WfmDownconverter {
    /// Broadcast FM: 2.4 MHz -> 480 kHz -> 240 kHz. The broad first
    /// filter removes aliases before 5:1 decimation; channel selection then
    /// needs 81 rather than 401 taps at one fifth of the input sample rate.
    /// Keep the same channel transition width and 240 kHz multiplex rate.
    pub(crate) fn new(offset: f64, bandwidth: f64) -> Self {
        let cutoff = (bandwidth.clamp(150_000.0, 220_000.0) / 2.0 - 5_000.0).max(65_000.0);
        // Four-term Blackman-Harris: flat through the widest WFM channel,
        // >100 dB rejection of aliases into +/-105 kHz around 480 kHz.
        Self {
            first: Downconverter::with_taps(offset, decimate_five_taps(INPUT_RATE), 5),
            second: ComplexDecimator::new(lowpass(81, cutoff, IF_RATE * 2.0), 2),
        }
    }
    pub(crate) fn process(&mut self, iq: &[u8]) -> Vec<f32> {
        let mut out = Vec::with_capacity(iq.len() / 10 + 2);
        for pair in iq.chunks_exact(2) {
            if let Some((i, q)) = self.first.push(pair[0], pair[1]) {
                if let Some((i, q)) = self.second.push(i, q) {
                    out.extend_from_slice(&[i, q]);
                }
            }
        }
        out
    }
}

impl Downconverter {
    pub(crate) fn new(offset: f64, cutoff: f64, taps: usize, decimation: usize) -> Self {
        Self::with_taps(offset, lowpass(taps, cutoff, INPUT_RATE), decimation)
    }
    fn with_taps(offset: f64, taps: Vec<f32>, decimation: usize) -> Self {
        let phase = -2.0 * PI * offset / INPUT_RATE;
        Self {
            osc_r: 1.0,
            osc_i: 0.0,
            step_r: phase.cos(),
            step_i: phase.sin(),
            filter: ComplexFir::new(taps),
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
        self.filter.push(
            i * self.osc_r as f32 - q * self.osc_i as f32,
            i * self.osc_i as f32 + q * self.osc_r as f32,
        );
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
            Some(self.filter.value())
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(taps: &[f32], hz: f64, rate: f64) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (n, &h) in taps.iter().enumerate() {
            let phase = 2.0 * PI * hz * n as f64 / rate;
            re += h as f64 * phase.cos();
            im += h as f64 * phase.sin();
        }
        re.hypot(im)
    }

    #[test]
    fn staged_wfm_preserves_channel_response_and_rejects_both_stages_aliases() {
        for bandwidth in [150_000.0_f64, 200_000.0, 220_000.0] {
            let front = WfmDownconverter::new(0.0, bandwidth);
            let second = &front.second;
            let legacy = lowpass(401, bandwidth / 2.0 - 5_000.0, INPUT_RATE);
            let gain = |hz| {
                response(&front.first.filter.taps, hz, INPUT_RATE)
                    * response(&second.filter.taps, hz, IF_RATE * 2.0)
            };
            // Include the channel skirts, not just a single audio tone.
            for hz in (0..=120_000).step_by(250) {
                assert!(
                    (gain(hz as f64) - response(&legacy, hz as f64, INPUT_RATE)).abs() < 0.0001,
                    "Channel response changed at {hz} Hz, bandwidth {bandwidth}"
                );
            }
            // Every input Nyquist-zone alias that could fold into +/-90 kHz
            // at the 240 kHz output. This includes aliases of the first stage
            // (480/960 kHz), which a final-stage filter cannot remove.
            for alias in 1..=5 {
                for base in (-90_000..=90_000).step_by(500) {
                    let hz = alias as f64 * IF_RATE + base as f64;
                    if hz > INPUT_RATE / 2.0 {
                        continue;
                    }
                    assert!(
                        gain(hz) < 10.0_f64.powf(-85.0 / 20.0),
                        "Insufficient alias rejection at {hz} Hz, bandwidth {bandwidth}"
                    );
                }
            }
            for hz in (375_000..=1_200_000).step_by(500) {
                assert!(response(&front.first.filter.taps, hz as f64, INPUT_RATE) < 1e-5);
            }
        }
    }

    #[test]
    fn staged_wfm_retains_240khz_phase_and_rate_across_arbitrary_chunks() {
        for offset in [-975_000.0, 187_500.0] {
            let iq: Vec<u8> = (0..240_000)
                .flat_map(|n| {
                    let p = 2.0 * PI * (offset + 57_000.0) * n as f64 / INPUT_RATE;
                    [
                        (127.5 + 80.0 * p.cos()).round() as u8,
                        (127.5 + 80.0 * p.sin()).round() as u8,
                    ]
                })
                .collect();
            let mut whole = WfmDownconverter::new(offset, 200_000.0);
            let output = whole.process(&iq);
            let mut stream = WfmDownconverter::new(offset, 200_000.0);
            let chunks: Vec<_> = iq.chunks(12346).flat_map(|b| stream.process(b)).collect();
            assert_eq!(output, chunks);
            assert_eq!(output.len(), 48_000);
            let phase: f64 = output
                .chunks_exact(2)
                .skip(500)
                .collect::<Vec<_>>()
                .windows(2)
                .map(|p| {
                    let [a, b] = [p[0], p[1]];
                    ((b[1] * a[0] - b[0] * a[1]) as f64).atan2((b[0] * a[0] + b[1] * a[1]) as f64)
                })
                .sum();
            let hz = phase / (24_000 - 500 - 1) as f64 * IF_RATE / (2.0 * PI);
            assert!((hz - 57_000.0).abs() < 2.0, "Frequency was {hz}");
        }
    }

    #[test]
    fn paired_iq_fir_matches_independent_convolutions_across_wraps_and_tails() {
        for length in [3, 5, 7, 9, 11, 71, 81, 401] {
            let taps = lowpass(length, 26_000.0, IF_RATE);
            let mut filter = ComplexFir::new(taps.clone());
            let mut history = vec![[0.0f32; 2]; length];
            let mut seed = 123456789u32;
            for _ in 0..length * 7 {
                let sample = std::array::from_fn(|_| {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    seed as i32 as f32 / i32::MAX as f32
                });
                history.rotate_left(1);
                *history.last_mut().unwrap() = sample;
                filter.push(sample[0], sample[1]);
                let actual = filter.value();
                for (ch, value) in [actual.0, actual.1].iter().enumerate() {
                    let expected: f32 = history.iter().zip(&taps).map(|(x, h)| x[ch] * h).sum();
                    assert!((value - expected).abs() < 2e-6);
                }
            }
        }
    }

    #[test]
    fn folded_fir_matches_reference_convolution_including_ring_wrap_and_asymmetric_taps() {
        for taps in [
            lowpass(11, 26000., IF_RATE),
            lowpass(13, 26000., IF_RATE),
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
