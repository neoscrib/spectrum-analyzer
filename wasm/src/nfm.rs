//! Streaming NFM with a narrow channelizer, carrier/noise squelch and code detection.
use super::{Fir, lowpass, squelch::CodeDetector};
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

struct Highpass {
    b: [f32; 3],
    a: [f32; 2],
    z: [f32; 2],
}
impl Highpass {
    fn new(q: f64) -> Self {
        let w = 2. * PI * 300. / 24000.;
        let alpha = w.sin() / (2. * q);
        let a0 = 1. + alpha;
        let b0 = (1. + w.cos()) / (2. * a0);
        Self {
            b: [b0 as f32, (-2. * b0) as f32, b0 as f32],
            a: [(-2. * w.cos() / a0) as f32, ((1. - alpha) / a0) as f32],
            z: [0.; 2],
        }
    }
    fn push(&mut self, x: f32) -> f32 {
        let y = self.b[0] * x + self.z[0];
        self.z[0] = self.b[1] * x - self.a[0] * y + self.z[1];
        self.z[1] = self.b[2] * x - self.a[1] * y;
        y
    }
}

#[wasm_bindgen]
pub struct NfmDecoder {
    re: f64,
    im: f64,
    wr: f64,
    wi: f64,
    integrators: [[i64; 2]; 3],
    combs: [[i64; 2]; 3],
    count: usize,
    i: Fir,
    q: Fir,
    previous: [f32; 2],
    dc: f32,
    power: f32,
    fast_power: f32,
    noise_filter: Fir,
    noise_delay: [f32; 32],
    noise_pos: usize,
    noise_power: f32,
    voice: Fir,
    highpass: [Highpass; 2],
    emphasis: f32,
    previous_audio: f32,
    deviation: f32,
    threshold: f32,
    off: bool,
    carrier: bool,
    good: u32,
    hang: u32,
    warmup: u32,
    gain: f32,
    sub_first: Fir,
    sub_second: Fir,
    codes: CodeDetector,
    samples: u64,
}
#[wasm_bindgen]
impl NfmDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(offset: f64, bandwidth: f64, deviation: f32, squelch: f32) -> Self {
        let p = -2. * PI * offset / 2400000.;
        let taps = lowpass(161, (bandwidth / 2. - 900.).clamp(3500., 11200.), 96000.);
        Self {
            re: 1.,
            im: 0.,
            wr: p.cos(),
            wi: p.sin(),
            integrators: [[0; 2]; 3],
            combs: [[0; 2]; 3],
            count: 0,
            i: Fir::new(taps.clone()),
            q: Fir::new(taps),
            previous: [0.; 2],
            dc: 0.,
            power: 0.,
            fast_power: 0.,
            noise_filter: Fir::new(lowpass(63, 4200., 24000.)),
            noise_delay: [0.; 32],
            noise_pos: 0,
            noise_power: 0.,
            voice: Fir::new(lowpass(63, 3200., 24000.)),
            highpass: [Highpass::new(0.5411961), Highpass::new(1.306563)],
            emphasis: 0.,
            previous_audio: 0.,
            deviation: deviation.clamp(2000., 7500.),
            threshold: squelch.clamp(-120., 0.),
            off: squelch <= -120.,
            carrier: false,
            good: 0,
            hang: 0,
            warmup: 1200,
            gain: 0.,
            sub_first: Fir::new(lowpass(63, 1200., 24000.)),
            sub_second: Fir::new(lowpass(81, 320., 4800.)),
            codes: CodeDetector::new(),
            samples: 0,
        }
    }
    /// CU8 2.4 MSPS -> interleaved 48 kHz mono PCM. State survives arbitrary chunks.
    pub fn process(&mut self, iq: &[u8]) -> Vec<f32> {
        let mut audio = Vec::with_capacity(iq.len() / 50 + 4);
        for pair in iq.chunks_exact(2) {
            let i = (pair[0] as f64 - 127.5) / 128.;
            let q = (pair[1] as f64 - 127.5) / 128.;
            let mut x = [
                ((i * self.re - q * self.im) * 32768.) as i64,
                ((i * self.im + q * self.re) * 32768.) as i64,
            ];
            let re = self.re * self.wr - self.im * self.wi;
            self.im = self.re * self.wi + self.im * self.wr;
            self.re = re;
            for stage in &mut self.integrators {
                for c in 0..2 {
                    stage[c] = stage[c].wrapping_add(x[c]);
                    x[c] = stage[c];
                }
            }
            self.count += 1;
            // LCM(4096 oscillator normalization, 25 CIC, 100 output decimation).
            // Keep the phase counter bounded during long scanner sessions.
            if self.count == 102400 {
                self.count = 0;
            }
            if self.count % 4096 == 0 {
                let norm = self.re.hypot(self.im);
                self.re /= norm;
                self.im /= norm;
            }
            if self.count % 25 != 0 {
                continue;
            }
            for stage in &mut self.combs {
                for c in 0..2 {
                    let old = stage[c];
                    stage[c] = x[c];
                    x[c] = x[c].wrapping_sub(old);
                }
            }
            self.i.push(x[0] as f32 / (15625. * 32768.));
            self.q.push(x[1] as f32 / (15625. * 32768.));
            if self.count % 100 != 0 {
                continue;
            }
            self.samples += 1;
            let z = [self.i.value(), self.q.value()];
            self.power += 0.004 * (z[0] * z[0] + z[1] * z[1] - self.power);
            self.fast_power += 0.02 * (z[0] * z[0] + z[1] * z[1] - self.fast_power);
            let cross = self.previous[0] * z[1] - self.previous[1] * z[0];
            let dot = self.previous[0] * z[0] + self.previous[1] * z[1];
            self.previous = z;
            let hz = cross.atan2(dot) * 24000. / (2. * std::f32::consts::PI);
            self.dc += 0.0013 * (hz - self.dc);
            let fm = hz - self.dc;
            self.noise_filter.push(fm);
            self.noise_delay[self.noise_pos] = fm;
            self.noise_pos = (self.noise_pos + 1) % 32;
            let noise = self.noise_delay[self.noise_pos] - self.noise_filter.value();
            self.noise_power += 0.002 * (noise * noise - self.noise_power);
            let level = 10. * self.power.max(1e-12).log10();
            let threshold = self.threshold - if self.carrier { 3. } else { 0. };
            let detected = level > threshold
                && 10. * self.fast_power.max(1e-12).log10() > threshold
                && self.noise_power.sqrt() < self.deviation * 0.18;
            if self.warmup > 0 {
                self.warmup -= 1;
            }
            if detected && self.warmup == 0 {
                self.good = self.good.saturating_add(1);
                if self.good >= 480 {
                    self.carrier = true;
                    self.hang = 6000;
                }
            } else {
                self.good = 0;
                if self.hang > 0 {
                    self.hang -= 1;
                } else if self.carrier {
                    self.carrier = false;
                    self.codes.reset();
                }
            }
            // Code detection receives un-deemphasized discriminator audio.
            // Explicit anti-alias filtering at both decimation stages prevents
            // voice (e.g. 1 kHz -> 200 Hz) masquerading as a CTCSS tone.
            self.sub_first.push(fm);
            if self.samples % 5 == 0 {
                self.sub_second.push(self.sub_first.value());
                if self.samples % 20 == 0 && self.carrier {
                    self.codes.push(self.sub_second.value());
                }
            }
            // Voice-only path removes subaudible signalling before playback.
            let voice = self.highpass[0].push(fm);
            let voice = self.highpass[1].push(voice);
            self.voice.push(voice);
            let v = self.voice.value() / self.deviation;
            self.emphasis += 0.05404 * (v - self.emphasis); // 750 us at 24 kHz.
            let target = if (self.carrier || self.off) && self.warmup == 0 {
                1.
            } else {
                0.
            };
            self.gain += (target - self.gain).clamp(-1. / 120., 1. / 120.);
            let current = (self.emphasis * 2.5).clamp(-1., 1.) * self.gain;
            let midpoint = (current + self.previous_audio) * 0.5;
            audio.extend_from_slice(&[midpoint, midpoint, current, current]);
            self.previous_audio = current;
        }
        audio
    }
    pub fn status(&self) -> String {
        serde_json::json!({"level":10.*self.power.max(1e-12).log10(),"noise":self.noise_power.sqrt()/self.deviation,"carrier":self.carrier,"open":(self.carrier||self.off)&&self.warmup==0,"ctcss":self.codes.ctcss(),"dcs":self.codes.dcs(),"seconds":self.samples as f64/24000.}).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn noise_does_not_open_squelch() {
        let mut seed = 42u32;
        let mut iq = Vec::with_capacity(4800000);
        for _ in 0..4800000 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            iq.push((120 + (seed >> 24) % 17) as u8);
        }
        let mut d = NfmDecoder::new(162500., 12500., 2500., -65.);
        let mut opened = false;
        for chunk in iq.chunks(131072) {
            d.process(chunk);
            opened |= d.carrier;
        }
        assert!(!opened, "noise opened squelch: {}", d.status());
    }
    fn iq(offset: f64, ctcss: bool) -> Vec<u8> {
        let mut phase = 0.;
        let mut data = Vec::new();
        for n in 0..4800000 {
            let t = n as f64 / 2400000.;
            let hz = offset
                + 1600. * (2. * PI * 1000. * t).sin()
                + if ctcss {
                    350. * (2. * PI * 100. * t).sin()
                } else {
                    0.
                };
            phase += 2. * PI * hz / 2400000.;
            data.push((127.5 + 55. * phase.cos()).round() as u8);
            data.push((127.5 + 55. * phase.sin()).round() as u8);
        }
        data
    }
    #[test]
    fn recovers_nfm_both_offset_signs_and_codes() {
        for offset in [-775000., 162500.] {
            let data = iq(offset, true);
            let mut d = NfmDecoder::new(offset, 12500., 2500., -65.);
            let mut out = Vec::new();
            for chunk in data.chunks(131072) {
                out.extend(d.process(chunk));
            }
            assert_eq!(out.len(), 192000);
            assert!(
                out.chunks_exact(2)
                    .all(|c| c[0] == c[1] && c[0].is_finite())
            );
            let stable: &[f32] = &out[48000..];
            let mut re = 0.;
            let mut im = 0.;
            for (n, v) in stable.iter().step_by(2).enumerate() {
                let p = 2. * PI * 1000. * n as f64 / 48000.;
                re += *v as f64 * p.cos();
                im += *v as f64 * p.sin();
            }
            assert!(2. * re.hypot(im) / (stable.len() / 2) as f64 > 0.1);
            assert!(d.carrier);
            assert_eq!(d.codes.ctcss(), Some(100.));
        }
    }
    #[test]
    fn squelch_and_chunk_boundaries() {
        let data = iq(162500., false);
        let mut a = NfmDecoder::new(162500., 12500., 2500., -5.);
        let silent = a.process(&data);
        assert!(silent.iter().all(|v| *v == 0.));
        let mut a = NfmDecoder::new(162500., 12500., 2500., -65.);
        let mut b = NfmDecoder::new(162500., 12500., 2500., -65.);
        let whole = a.process(&data);
        assert_eq!(a.codes.ctcss(), None, "a voice tone aliased into CTCSS");
        assert!(a.codes.dcs().is_empty());
        let mut chunks = Vec::new();
        for c in data.chunks(4802) {
            chunks.extend(b.process(c));
        }
        assert_eq!(whole.len(), chunks.len());
        assert!(whole.iter().zip(chunks).all(|(a, b)| (a - b).abs() < 1e-6));
    }
}
