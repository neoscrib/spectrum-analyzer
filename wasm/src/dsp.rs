//! Shared DSP source. High-rate FIR channelization is exported only by dsp_core.
use std::f64::consts::PI;
pub(crate) const INPUT_RATE: f64 = 2_400_000.0;
pub(crate) const IF_RATE: f64 = 240_000.0;
pub(crate) const AUDIO_RATE: f64 = 48_000.0;

pub(crate) fn lowpass(taps: usize, cutoff: f64, rate: f64) -> Vec<f32> {
    let mut out = Vec::with_capacity(taps);
    for n in 0..taps {
        let x = n as f64 - (taps - 1) as f64 / 2.0;
        let sinc = if x == 0.0 {
            2.0 * cutoff / rate
        } else {
            (2.0 * PI * cutoff / rate * x).sin() / (PI * x)
        };
        let window = 0.42 - 0.5 * (2.0 * PI * n as f64 / (taps - 1) as f64).cos()
            + 0.08 * (4.0 * PI * n as f64 / (taps - 1) as f64).cos();
        out.push((sinc * window) as f32);
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
}
impl Fir {
    pub(crate) fn new(taps: Vec<f32>) -> Self {
        Self {
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
        self.ring[self.index..self.index + self.taps.len()]
            .iter()
            .zip(&self.taps)
            .map(|(x, h)| x * h)
            .sum()
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
        self.count = (self.count + 1) % (4096 * self.decimation);
        if self.count % 4096 == 0 {
            let length = self.osc_r.hypot(self.osc_i);
            self.osc_r /= length;
            self.osc_i /= length;
        }
        if self.count % self.decimation == 0 {
            Some((self.i.value(), self.q.value()))
        } else {
            None
        }
    }
}
