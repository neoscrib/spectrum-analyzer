//! Streaming stereo broadcast-FM receiver. CU8 IQ at 2.4 MSPS -> interleaved L/R PCM at 48 kHz.
//! All filter, oscillator, discriminator and decimation state survives block boundaries.
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;
mod ook;
pub use ook::OokDecoder;
mod am;
pub use am::AmDecoder;
mod nfm;
mod squelch;
pub use nfm::NfmDecoder;
mod armer;
pub use armer::Receiver;
mod wwv;
pub use wwv::WwvDecoder;

const INPUT_RATE: f64 = 2_400_000.0;
const IF_RATE: f64 = 240_000.0;
const AUDIO_RATE: f64 = 48_000.0;

fn lowpass(taps: usize, cutoff: f64, rate: f64) -> Vec<f32> {
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

struct Fir {
    taps: Vec<f32>,
    // Mirrored ring avoids a modulo operation for every coefficient.
    ring: Vec<f32>,
    index: usize,
}
impl Fir {
    fn new(taps: Vec<f32>) -> Self {
        Self {
            ring: vec![0.0; taps.len() * 2],
            taps,
            index: 0,
        }
    }
    fn push(&mut self, value: f32) {
        self.ring[self.index] = value;
        self.ring[self.index + self.taps.len()] = value;
        self.index += 1;
        if self.index == self.taps.len() {
            self.index = 0;
        }
    }
    fn value(&self) -> f32 {
        self.ring[self.index..self.index + self.taps.len()]
            .iter()
            .zip(&self.taps)
            .map(|(x, h)| x * h)
            .sum()
    }
}

/// Shared streaming CU8 mixer / complex FIR / integer decimator.
struct Downconverter {
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
    fn new(offset: f64, cutoff: f64, taps: usize, decimation: usize) -> Self {
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
    fn push(&mut self, i: u8, q: u8) -> Option<(f32, f32)> {
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

/// Coherent pilot recovery using quadrature translation and a narrow two-pole
/// low-pass. The complex envelope tracks the pilot's phase and small frequency
/// error. Doubling the recovered phase regenerates the suppressed 38 kHz carrier.
/// ITU-R BS.450: pilot = sin(theta), difference subcarrier = sin(2*theta).
struct Pilot {
    osc_r: f64,
    osc_i: f64,
    step_r: f64,
    step_i: f64,
    i: [f64; 2],
    q: [f64; 2],
    mean_i: f64,
    mean_q: f64,
    power: f64,
    level: f64,
    good: usize,
    bad: usize,
    samples: usize,
    locked: bool,
}
impl Pilot {
    fn new() -> Self {
        let step = 2.0 * PI * 19_000.0 / IF_RATE;
        Self {
            osc_r: 1.0,
            osc_i: 0.0,
            step_r: step.cos(),
            step_i: step.sin(),
            i: [0.0; 2],
            q: [0.0; 2],
            mean_i: 0.0,
            mean_q: 0.0,
            power: 0.0,
            level: 0.0,
            good: 0,
            bad: 0,
            samples: 0,
            locked: false,
        }
    }
    fn process(&mut self, fm: f32) -> f32 {
        // 200 Hz envelope passband; coherent averaging rejects broadband noise.
        const FAST: f64 = 0.00522230386540432; // 1-exp(-2*pi*200/240000)
        const SLOW: f64 = 0.00041657987316623; // 10 ms time constant
        self.i[0] += FAST * (fm as f64 * self.osc_r - self.i[0]);
        self.q[0] += FAST * (-fm as f64 * self.osc_i - self.q[0]);
        self.i[1] += FAST * (self.i[0] - self.i[1]);
        self.q[1] += FAST * (self.q[0] - self.q[1]);
        self.mean_i += SLOW * (self.i[1] - self.mean_i);
        self.mean_q += SLOW * (self.q[1] - self.mean_q);
        let norm = self.i[1] * self.i[1] + self.q[1] * self.q[1];
        self.power += SLOW * (norm - self.power);
        // Envelope is half the pilot's deviation-normalized amplitude.
        self.level = 2.0 * self.power.max(0.0).sqrt();
        let coherence =
            (self.mean_i * self.mean_i + self.mean_q * self.mean_q) / self.power.max(1e-15);
        let good = self.level > 0.025 && self.level < 0.18 && coherence > 0.8;
        if good {
            self.good = (self.good + 1).min(19_200);
            self.bad = 0;
            if self.good >= 19_200 {
                self.locked = true;
            } // 80 ms acquisition
        } else {
            self.good = 0;
            self.bad = (self.bad + 1).min(4_800);
            if self.bad >= 4_800 {
                self.locked = false;
            } // 20 ms release
        }
        let re = self.i[1] * self.osc_r - self.q[1] * self.osc_i;
        let im = self.i[1] * self.osc_i + self.q[1] * self.osc_r;
        // Analytic pilot has phase theta-pi/2, hence the minus sign.
        let carrier = (-2.0 * re * im / norm.max(1e-15)) as f32;
        let next_r = self.osc_r * self.step_r - self.osc_i * self.step_i;
        self.osc_i = self.osc_r * self.step_i + self.osc_i * self.step_r;
        self.osc_r = next_r;
        self.samples += 1;
        if self.samples % 4096 == 0 {
            let length = self.osc_r.hypot(self.osc_i);
            self.osc_r /= length;
            self.osc_i /= length;
        }
        carrier
    }
}

#[wasm_bindgen]
pub struct WfmDecoder {
    front: Downconverter,
    audio: Fir,
    difference: Fir,
    pilot: Pilot,
    stereo_enabled: bool,
    blend: f32,
    if_count: usize,
    previous_i: f32,
    previous_q: f32,
    deemphasis: [f32; 2],
    deemphasis_alpha: f32,
    dc_input: [f32; 2],
    dc_output: [f32; 2],
    warmup: usize,
}

#[wasm_bindgen]
impl WfmDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(offset_hz: f64, bandwidth_hz: f64, deemphasis_us: f64) -> WfmDecoder {
        Self {
            front: Downconverter::new(
                offset_hz,
                (bandwidth_hz.clamp(150_000.0, 220_000.0) / 2.0 - 5_000.0).max(65_000.0),
                401,
                10,
            ),
            audio: Fir::new(lowpass(161, 15_000.0, IF_RATE)),
            difference: Fir::new(lowpass(161, 15_000.0, IF_RATE)),
            pilot: Pilot::new(),
            stereo_enabled: true,
            blend: 0.0,
            if_count: 0,
            previous_i: 0.0,
            previous_q: 0.0,
            deemphasis: [0.0; 2],
            deemphasis_alpha: if deemphasis_us <= 0.0 {
                1.0
            } else {
                (1.0 - (-1.0 / (AUDIO_RATE * deemphasis_us * 1e-6)).exp()) as f32
            },
            dc_input: [0.0; 2],
            dc_output: [0.0; 2],
            warmup: 480,
        }
    }

    pub fn set_stereo_enabled(&mut self, enabled: bool) {
        self.stereo_enabled = enabled;
    }
    pub fn stereo_locked(&self) -> bool {
        self.stereo_enabled && self.pilot.locked && self.blend > 0.95
    }
    pub fn pilot_level(&self) -> f32 {
        self.pilot.level as f32
    }

    pub fn process(&mut self, iq: &[u8]) -> Vec<f32> {
        let mut out = Vec::with_capacity(iq.len() / 50 + 2);
        for pair in iq.chunks_exact(2) {
            let Some((i, q)) = self.front.push(pair[0], pair[1]) else {
                continue;
            };
            let real = i * self.previous_i + q * self.previous_q;
            let imag = q * self.previous_i - i * self.previous_q;
            self.previous_i = i;
            self.previous_q = q;
            let fm = imag.atan2(real) * (IF_RATE / (2.0 * PI * 75_000.0)) as f32;
            let carrier = self.pilot.process(fm);
            self.audio.push(fm);
            self.difference.push(fm * 2.0 * carrier);
            self.if_count += 1;
            if self.if_count % 5 != 0 {
                continue;
            }
            // Fade separation in/out over 40 ms; do not abruptly switch channels.
            let target = if self.stereo_enabled && self.pilot.locked {
                1.0
            } else {
                0.0
            };
            self.blend += 0.0005206977 * (target - self.blend);
            let sum = self.audio.value();
            // A phase-difference discriminator averages frequency over one IF
            // sample interval. Correct its sinc droop at 38 kHz so L-R has the
            // same gain as L+R; otherwise even a clean station leaks ~4% of L-R.
            let difference = self.difference.value() * self.blend * 1.0424598;
            for (ch, sample) in [sum + difference, sum - difference].iter().enumerate() {
                self.deemphasis[ch] += self.deemphasis_alpha * (*sample - self.deemphasis[ch]);
                // Remove residual tuning DC after de-emphasis (~30 Hz high-pass).
                let dc = self.deemphasis[ch] - self.dc_input[ch] + 0.996 * self.dc_output[ch];
                self.dc_input[ch] = self.deemphasis[ch];
                self.dc_output[ch] = dc;
                out.push(if self.warmup > 0 {
                    0.0
                } else {
                    dc.clamp(-1.0, 1.0)
                });
            }
            if self.warmup > 0 {
                self.warmup -= 1;
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(offset: f64, tone: f64, seconds: f64, deviation: f64) -> Vec<u8> {
        let mut phase = 0.0;
        let mut iq = Vec::new();
        for n in 0..(INPUT_RATE * seconds) as usize {
            let audio = (2.0 * PI * tone * n as f64 / INPUT_RATE).sin();
            phase += 2.0 * PI * (offset + deviation * audio) / INPUT_RATE;
            iq.push((127.5 + 85.0 * phase.cos()).round() as u8);
            iq.push((127.5 + 85.0 * phase.sin()).round() as u8);
        }
        iq
    }
    fn power(samples: &[f32]) -> f64 {
        samples.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / samples.len() as f64
    }
    fn left(samples: &[f32]) -> Vec<f32> {
        samples.iter().step_by(2).copied().collect()
    }
    fn tone_amplitude(samples: &[f32], hz: f64) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (n, x) in samples.iter().enumerate() {
            let phase = 2.0 * PI * hz * n as f64 / AUDIO_RATE;
            re += *x as f64 * phase.cos();
            im += *x as f64 * phase.sin();
        }
        2.0 * re.hypot(im) / samples.len() as f64
    }
    #[test]
    fn recovers_fm_at_positive_and_negative_offsets() {
        for offset in [375_000.0, -525_000.0] {
            let iq = fixture(offset, 1000.0, 0.15, 60_000.0);
            let audio = WfmDecoder::new(offset, 200_000.0, 75.0).process(&iq);
            assert_eq!(audio.len(), 14400);
            let audio = left(&audio);
            let stable = &audio[1500..];
            assert!(tone_amplitude(stable, 1000.0) > 0.65);
            assert!(tone_amplitude(stable, 3000.0) < 0.01);
            assert!(power(stable) > 0.20);
        }
    }
    #[test]
    fn streaming_matches_contiguous_processing() {
        let iq = fixture(100_000.0, 1300.0, 0.08, 50_000.0);
        let expected = WfmDecoder::new(100_000.0, 200_000.0, 50.0).process(&iq);
        let mut decoder = WfmDecoder::new(100_000.0, 200_000.0, 50.0);
        let actual: Vec<f32> = iq
            .chunks(12346)
            .flat_map(|chunk| decoder.process(chunk))
            .collect();
        assert_eq!(expected, actual);
    }
    #[test]
    fn deemphasis_attenuates_high_frequency_and_audio_filter_rejects_pilot() {
        let high = fixture(100_000.0, 10_000.0, 0.1, 20_000.0);
        let flat = left(&WfmDecoder::new(100_000.0, 200_000.0, 0.0).process(&high));
        let deemph = left(&WfmDecoder::new(100_000.0, 200_000.0, 75.0).process(&high));
        assert!(power(&deemph[1500..]) < power(&flat[1500..]) * 0.06);
        let pilot = fixture(100_000.0, 19_000.0, 0.1, 10_000.0);
        let audio = left(&WfmDecoder::new(100_000.0, 200_000.0, 0.0).process(&pilot));
        assert!(tone_amplitude(&audio[1500..], 19_000.0) < 0.003);
    }

    fn stereo_fixture(
        pilot_hz: f64,
        pilot_phase: f64,
        seconds: f64,
        pilot_amplitude: f64,
    ) -> Vec<u8> {
        let mut iq = Vec::new();
        let mut phase = 0.0;
        for n in 0..(INPUT_RATE * seconds) as usize {
            let t = n as f64 / INPUT_RATE;
            let l = 0.5 * (2.0 * PI * 1000.0 * t).sin();
            let r = 0.5 * (2.0 * PI * 2300.0 * t).sin();
            let theta = 2.0 * PI * pilot_hz * t + pilot_phase;
            let mpx =
                0.5 * (l + r) + 0.5 * (l - r) * (2.0 * theta).sin() + pilot_amplitude * theta.sin();
            phase += 2.0 * PI * (-375_000.0 + 75_000.0 * mpx) / INPUT_RATE;
            iq.push((127.5 + 80.0 * phase.cos()).round() as u8);
            iq.push((127.5 + 80.0 * phase.sin()).round() as u8);
        }
        iq
    }
    #[test]
    fn separates_stereo_with_arbitrary_pilot_phase_and_frequency_error() {
        for (hz, phase) in [(19_000.0, 0.0), (19_002.0, 1.3), (18_998.0, -2.0)] {
            let iq = stereo_fixture(hz, phase, 0.55, 0.09);
            let mut decoder = WfmDecoder::new(-375_000.0, 200_000.0, 0.0);
            let audio: Vec<f32> = iq.chunks(131072).flat_map(|c| decoder.process(c)).collect();
            assert!(decoder.stereo_locked(), "pilot failed to lock at {hz} Hz");
            assert!((0.07..0.11).contains(&decoder.pilot_level()));
            let left: Vec<f32> = audio.iter().step_by(2).skip(18000).copied().collect();
            let right: Vec<f32> = audio
                .iter()
                .skip(1)
                .step_by(2)
                .skip(18000)
                .copied()
                .collect();
            let l = tone_amplitude(&left, 1000.0);
            let r = tone_amplitude(&right, 2300.0);
            let leak_l = tone_amplitude(&left, 2300.0);
            let leak_r = tone_amplitude(&right, 1000.0);
            assert!(l > 0.4 && r > 0.4, "wrong channel levels: {l}, {r}");
            assert!(
                leak_l / r < 0.01 && leak_r / l < 0.01,
                "poor separation: L {l}/{leak_l}; R {r}/{leak_r}"
            );
        }
    }
    #[test]
    fn mono_without_pilot_and_forced_mono_do_not_invent_stereo() {
        let iq = fixture(100_000.0, 1000.0, 0.2, 60_000.0);
        let mut decoder = WfmDecoder::new(100_000.0, 200_000.0, 75.0);
        let audio = decoder.process(&iq);
        assert!(!decoder.stereo_locked());
        assert!(audio.chunks_exact(2).all(|s| s[0] == s[1]));
        let iq = stereo_fixture(19000.0, 0.7, 0.4, 0.09);
        let mut decoder = WfmDecoder::new(-375_000.0, 200_000.0, 0.0);
        decoder.set_stereo_enabled(false);
        let audio = decoder.process(&iq);
        assert!(!decoder.stereo_locked());
        assert!(audio.chunks_exact(2).all(|s| s[0] == s[1]));
    }
    #[test]
    fn losing_pilot_fades_back_to_mono_and_noise_does_not_lock() {
        let mut decoder = WfmDecoder::new(-375_000.0, 200_000.0, 0.0);
        decoder.process(&stereo_fixture(19000.0, 0.3, 0.5, 0.09));
        assert!(decoder.stereo_locked());
        let audio = decoder.process(&stereo_fixture(19000.0, 0.3, 0.6, 0.0));
        assert!(!decoder.stereo_locked());
        assert!(
            audio[audio.len() - 4000..]
                .chunks_exact(2)
                .all(|s| (s[0] - s[1]).abs() < 1e-5)
        );
        let mut pilot = Pilot::new();
        let mut seed = 12345u32;
        for _ in 0..120000 {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            pilot.process((seed as f64 / u32::MAX as f64 - 0.5) as f32);
            assert!(
                !pilot.locked,
                "broadband noise was mistaken for stereo pilot"
            );
        }
    }
}
