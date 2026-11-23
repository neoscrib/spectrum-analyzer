//! Streaming binary ASK/OOK envelope and pulse acquisition. No device protocol
//! or checksum is inferred here: pulse interpretation belongs to the caller.
#[cfg(not(target_arch = "wasm32"))]
use super::Downconverter;
use super::{Fir, IF_RATE, lowpass};
use serde::Serialize;
use wasm_bindgen::prelude::*;

const RATE: f64 = 120_000.0;
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Burst {
    start_seconds: f64,
    end_seconds: f64,
    /// Alternating high / low microseconds, beginning high and ending low.
    durations: Vec<f64>,
    /// The final idle interval is the observed delimiter, a lower bound.
    gap_lower_bound: bool,
}
#[wasm_bindgen]
pub struct OokDecoder {
    #[cfg(not(target_arch = "wasm32"))]
    front: Downconverter,
    i: Fir,
    q: Fir,
    phase: bool,
    ticks: u64,
    manual: Option<f32>,
    threshold: f32,
    noise: f32,
    peak: f32,
    level: f32,
    high: bool,
    candidate: u32,
    min_ticks: u32,
    gap_ticks: u64,
    run_start: u64,
    burst_start: u64,
    durations: Vec<f64>,
    frames: Vec<Burst>,
    blocked: bool,
    bursts: u64,
    rejected: u64,
    trace: Vec<f32>,
    trace_at: usize,
    trace_peak: f32,
}
#[wasm_bindgen]
impl OokDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(
        _offset_hz: f64,
        bandwidth_hz: f64,
        threshold_db: f32,
        min_pulse_us: f64,
        gap_us: f64,
    ) -> Self {
        let taps = lowpass(
            129,
            (bandwidth_hz.clamp(10000.0, 100000.0) / 2.0 - 1000.0).max(3000.0),
            IF_RATE,
        );
        let manual = (threshold_db > -110.0).then(|| 10.0_f32.powf(threshold_db / 20.0));
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            front: Downconverter::new(_offset_hz, 90000.0, 161, 10),
            i: Fir::new(taps.clone()),
            q: Fir::new(taps),
            phase: false,
            ticks: 0,
            manual,
            threshold: manual.unwrap_or(0.01),
            noise: 0.00001,
            peak: 0.001,
            level: 0.0,
            high: false,
            candidate: 0,
            min_ticks: (min_pulse_us.clamp(25.0, 5000.0) * RATE / 1e6).ceil() as u32,
            gap_ticks: (gap_us.clamp(1000.0, 100000.0) * RATE / 1e6).ceil() as u64,
            run_start: 0,
            burst_start: 0,
            durations: Vec::new(),
            frames: Vec::new(),
            blocked: false,
            bursts: 0,
            rejected: 0,
            trace: vec![0.0; 512],
            trace_at: 0,
            trace_peak: 0.0,
        }
    }
    /// CU8 at 2.4 MSPS -> complex channel filter -> 120 kSPS magnitude.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn process(&mut self, iq: &[u8]) {
        let baseband = self.front.process(iq);
        self.process_baseband(&baseband);
    }
    /// Normalized F32 I/Q at 240 kSPS from dsp_core.
    pub fn process_baseband(&mut self, iq: &[f32]) {
        for pair in iq.chunks_exact(2) {
            self.i.push(pair[0]);
            self.q.push(pair[1]);
            self.phase = !self.phase;
            if !self.phase {
                self.push_envelope(self.i.value().hypot(self.q.value()));
            }
        }
    }
    pub fn take_bursts(&mut self) -> String {
        serde_json::to_string(&std::mem::take(&mut self.frames)).unwrap()
    }
    pub fn status(&self) -> String {
        fn db(v: f32) -> f32 {
            20.0 * v.max(1e-6).log10()
        }
        serde_json::json!({
            "seconds": self.ticks as f64 / RATE,
            "level": db(self.level), "noise": db(self.noise), "peak": db(self.peak),
            "threshold": db(self.threshold), "high": self.high,
            "bursts": self.bursts, "rejected": self.rejected,
            "sampleRate": RATE,
            "traceRate": RATE / 10.0,
            "trace": self.trace[self.trace_at..].iter().chain(&self.trace[..self.trace_at]).map(|v| db(*v)).collect::<Vec<_>>(),
        }).to_string()
    }
}
impl OokDecoder {
    fn push_envelope(&mut self, value: f32) {
        self.ticks += 1;
        self.trace_peak = self.trace_peak.max(value);
        if self.ticks % 10 == 0 {
            self.trace[self.trace_at] = self.trace_peak;
            self.trace_peak = 0.0;
            self.trace_at = (self.trace_at + 1) % self.trace.len();
        }
        self.level += 0.002 * (value - self.level);
        // Slow upward floor tracking ignores short transmissions; peak hold
        // follows fading while retaining both ASK amplitude levels between edges.
        let floor_alpha = if self.ticks <= 2400 {
            0.01
        } else if value < self.noise {
            0.02
        } else if !self.high && value < self.threshold * 0.85 {
            0.00005
        } else {
            0.0
        };
        self.noise += floor_alpha * (value - self.noise);
        self.peak += if value > self.peak { 0.1 } else { 0.000004 } * (value - self.peak);
        self.threshold = self.manual.unwrap_or_else(|| {
            ((self.peak + self.noise) * 0.5)
                .max(self.noise * 1.8)
                .max(0.0017782794)
        }); // -55 dBFS floor
        // Avoid filter startup artifacts. No partial burst carried from startup.
        if self.ticks <= 2400 {
            self.run_start = self.ticks;
            return;
        }
        let raw = value > self.threshold * if self.high { 0.85 } else { 1.15 };
        if raw != self.high {
            self.candidate += 1;
            if self.candidate >= self.min_ticks {
                let edge = self.ticks + 1 - self.candidate as u64;
                if !self.blocked {
                    if self.high || !self.durations.is_empty() {
                        self.durations
                            .push((edge - self.run_start) as f64 * 1e6 / RATE);
                    } else {
                        self.burst_start = edge;
                    }
                }
                self.high = raw;
                self.run_start = edge;
                self.candidate = 0;
            }
        } else {
            self.candidate = 0;
        }
        let idle = self.ticks - self.run_start;
        if !self.high && self.candidate == 0 && idle >= self.gap_ticks {
            if !self.durations.is_empty() {
                self.durations.push(idle as f64 * 1e6 / RATE);
                if self.durations.len() >= 2 {
                    self.bursts += 1;
                    if self.frames.len() < 32 {
                        self.frames.push(Burst {
                            start_seconds: self.burst_start as f64 / RATE,
                            end_seconds: self.run_start as f64 / RATE,
                            durations: std::mem::take(&mut self.durations),
                            gap_lower_bound: true,
                        });
                    } else {
                        self.rejected += 1;
                        self.durations.clear();
                    }
                } else {
                    self.rejected += 1;
                    self.durations.clear();
                }
            }
            self.blocked = false;
        }
        if !self.blocked
            && (self.durations.len() >= 2048
                || (self.high || !self.durations.is_empty())
                    && self.ticks - self.burst_start >= 240000)
        {
            self.durations.clear();
            self.blocked = true;
            self.rejected += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;
    fn fixture(offset: f64, ask: bool, adjacent: bool) -> Vec<u8> {
        (0..480000)
            .flat_map(|n| {
                let t = n as f64 / 2400000.0;
                let us = (t * 1e6) as u64;
                let on = (50000..62000).contains(&us) && {
                    let cell = (us - 50000) / 1500;
                    (us - 50000) % 1500 < if cell % 2 == 0 { 500 } else { 1000 }
                };
                let amplitude = if on {
                    55.0
                } else if ask {
                    10.0
                } else {
                    0.0
                };
                let p = 2.0 * PI * offset * t;
                let other = 2.0 * PI * (offset + 65000.0) * t;
                let b = if adjacent { 25.0 } else { 0.0 };
                [
                    (127.5 + amplitude * p.cos() + b * other.cos()).round() as u8,
                    (127.5 + amplitude * p.sin() + b * other.sin()).round() as u8,
                ]
            })
            .collect()
    }
    #[test]
    fn iq_recovers_ook_and_ask_at_both_offsets_and_rejects_neighbor() {
        for offset in [-425000.0, 275000.0] {
            for ask in [false, true] {
                let mut d = OokDecoder::new(offset, 25000.0, -120.0, 50.0, 5000.0);
                d.process(&fixture(offset, ask, true));
                assert_eq!(d.frames.len(), 1, "{offset} {ask} {}", d.status());
                let frame = &d.frames[0];
                assert_eq!(frame.durations.len(), 16);
                for (i, pair) in frame.durations.chunks_exact(2).enumerate() {
                    let expected = if i % 2 == 0 { 500.0 } else { 1000.0 };
                    assert!((pair[0] - expected).abs() < 90.0, "{:?}", frame);
                    if i < 7 {
                        assert!((pair[1] - (1500.0 - expected)).abs() < 60.0);
                    }
                }
            }
        }
    }
    #[test]
    fn iq_chunk_boundaries_do_not_change_edges() {
        let iq = fixture(275000.0, false, false);
        let mut a = OokDecoder::new(275000.0, 50000.0, -20.0, 50.0, 5000.0);
        let mut b = OokDecoder::new(275000.0, 50000.0, -20.0, 50.0, 5000.0);
        a.process(&iq);
        for chunk in iq.chunks(12346) {
            b.process(chunk);
        }
        assert_eq!(a.frames, b.frames);
        assert_eq!(a.status(), b.status());
    }
    #[test]
    fn rejects_noise_glitches_and_limits_unterminated_carriers() {
        let mut d = OokDecoder::new(0.0, 50000.0, -120.0, 50.0, 5000.0);
        let mut rng = 1u32;
        for n in 0..60000 {
            rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((rng >> 16) as f32 / 65535.0) * 0.0005;
            d.push_envelope(if n == 5000 { 0.4 } else { noise });
        }
        assert!(d.frames.is_empty());
        for _ in 0..250000 {
            d.push_envelope(0.4);
        }
        assert!(d.frames.is_empty());
        assert!(d.blocked);
        assert_eq!(d.rejected, 1);
        for _ in 0..6000 {
            d.push_envelope(0.0);
        }
        assert!(!d.blocked);
    }
}
