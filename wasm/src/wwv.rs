//! WWV/WWVH modified IRIG-H, per NIST's published time-code diagram.
//! No computer clock or network time participates in acquisition/validation.
use super::{AUDIO_RATE, am::AmDemodulator};
use serde::Serialize;
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timecode {
    pub year: u16,
    pub day_of_year: u16,
    pub hour: u8,
    pub minute: u8,
    pub dut1: f32,
    pub leap_warning: bool,
    pub dst1: bool,
    pub dst2: bool,
    pub confirmed: bool,
    pub consecutive_frames: u32,
}
fn leap(year: u16) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}
fn minute_number(t: &Timecode) -> i64 {
    let days: i64 = (2000..t.year)
        .map(|y| if leap(y) { 366 } else { 365 })
        .sum();
    ((days + t.day_of_year as i64 - 1) * 24 + t.hour as i64) * 60 + t.minute as i64
}
fn digit(bits: &[i8; 60], indices: &[usize]) -> u16 {
    indices
        .iter()
        .enumerate()
        .map(|(n, i)| (bits[*i] as u16) << n)
        .sum()
}
pub fn parse_frame(b: &[i8; 60]) -> Result<Timecode, &'static str> {
    if b[0] != -1 {
        return Err("Missing minute-reference hole");
    }
    for (i, bit) in b.iter().enumerate().skip(1) {
        if i % 10 == 9 {
            if *bit != 2 {
                return Err("Invalid position marker");
            }
        } else if *bit != 0 && *bit != 1 {
            return Err("Uncertain data pulse");
        }
    }
    for i in [1, 8, 14, 18, 24, 27, 28, 34, 42, 43, 44, 45, 46, 47, 48] {
        if b[i] != 0 {
            return Err("Reserved bit is not zero");
        }
    }
    let yu = digit(b, &[4, 5, 6, 7]);
    let yt = digit(b, &[51, 52, 53, 54]);
    let mu = digit(b, &[10, 11, 12, 13]);
    let mt = digit(b, &[15, 16, 17]);
    let hu = digit(b, &[20, 21, 22, 23]);
    let ht = digit(b, &[25, 26]);
    let du = digit(b, &[30, 31, 32, 33]);
    let dt = digit(b, &[35, 36, 37, 38]);
    let dh = digit(b, &[40, 41]);
    if [yu, yt, mu, hu, du, dt].iter().any(|n| *n > 9) || mt > 5 || ht > 2 || dh > 3 {
        return Err("Invalid BCD digit");
    }
    let year = 2000 + yt * 10 + yu; // WWV supplies only two year digits.
    let day = dh * 100 + dt * 10 + du;
    let hour = ht * 10 + hu;
    if hour > 23 || day == 0 || day > if leap(year) { 366 } else { 365 } {
        return Err("Invalid calendar date/time");
    }
    Ok(Timecode {
        year,
        day_of_year: day,
        hour: hour as u8,
        minute: (mt * 10 + mu) as u8,
        dut1: digit(b, &[56, 57, 58]) as f32 * if b[50] == 1 { 0.1 } else { -0.1 },
        leap_warning: b[3] == 1,
        dst1: b[55] == 1,
        dst2: b[2] == 1,
        confirmed: false,
        consecutive_frames: 1,
    })
}

struct Receiver {
    samples: u64,
    osc_r: f64,
    osc_i: f64,
    step_r: f64,
    step_i: f64,
    i: [f64; 2],
    q: [f64; 2],
    peak: f64,
    level: f64,
    active: bool,
    blocked: bool,
    rise: u64,
    last_rise: Option<u64>,
    last_symbol: i8,
    second: Option<u8>,
    bits: [i8; 60],
    pulse_ms: f32,
    frame: Option<Timecode>,
    last_frame_sample: Option<u64>,
    confirmed: bool,
    valid: u32,
    rejected: u32,
    error: Option<&'static str>,
}
impl Receiver {
    fn new() -> Self {
        let step = 2.0 * PI * 100.0 / AUDIO_RATE;
        Self {
            samples: 0,
            osc_r: 1.0,
            osc_i: 0.0,
            step_r: step.cos(),
            step_i: step.sin(),
            i: [0.0; 2],
            q: [0.0; 2],
            peak: 0.0,
            level: 0.0,
            active: false,
            blocked: false,
            rise: 0,
            last_rise: None,
            last_symbol: -2,
            second: None,
            bits: [-2; 60],
            pulse_ms: 0.0,
            frame: None,
            last_frame_sample: None,
            confirmed: false,
            valid: 0,
            rejected: 0,
            error: None,
        }
    }
    fn lose_sync(&mut self, reason: &'static str) {
        self.second = None;
        self.confirmed = false;
        self.error = Some(reason);
    }
    fn feed(&mut self, sample: f32) {
        const A: f64 = 0.00261456992; // two-pole 20 Hz LP after mixing 100 Hz to DC
        self.i[0] += A * (sample as f64 * self.osc_r - self.i[0]);
        self.q[0] += A * (-sample as f64 * self.osc_i - self.q[0]);
        self.i[1] += A * (self.i[0] - self.i[1]);
        self.q[1] += A * (self.q[0] - self.q[1]);
        let next = self.osc_r * self.step_r - self.osc_i * self.step_i;
        self.osc_i = self.osc_r * self.step_i + self.osc_i * self.step_r;
        self.osc_r = next;
        self.samples += 1;
        if self.samples % 4096 == 0 {
            let n = self.osc_r.hypot(self.osc_i);
            self.osc_r /= n;
            self.osc_i /= n;
        }
        if self.samples % 240 != 0 {
            return;
        } // pulse decisions at 5 ms resolution
        self.level = 2.0 * self.i[1].hypot(self.q[1]);
        self.peak = self.level.max(self.peak * 0.99750312); // 2 second peak decay
        let high = (self.peak * 0.5).max(0.025);
        let low = (self.peak * 0.35).max(0.018);
        if self.blocked {
            if self.level < low {
                self.blocked = false;
            }
        } else if !self.active && self.level > high {
            self.active = true;
            self.rise = self.samples;
            if let Some(previous) = self.last_rise {
                let gap = (self.samples - previous) as f64 / AUDIO_RATE;
                if (1.85..2.15).contains(&gap) && self.last_symbol == 2 {
                    // P0 at second 59, no 100 Hz code at second 0, then zero at 1.
                    self.second = Some(1);
                    self.bits = [-2; 60];
                    self.bits[0] = -1;
                    self.error = None;
                } else if (0.9..1.1).contains(&gap) {
                    if let Some(s) = self.second {
                        if s < 59 {
                            self.second = Some(s + 1);
                        } else {
                            self.lose_sync("Missing minute-reference hole");
                        }
                    }
                } else {
                    self.lose_sync("Second cadence lost");
                }
            }
            self.last_rise = Some(self.samples);
        } else if self.active && self.level < low {
            self.active = false;
            self.complete_pulse();
        } else if self.active && self.samples - self.rise > 43_200 {
            self.active = false;
            self.blocked = true;
            self.last_symbol = -2;
            self.lose_sync("100 Hz tone is not pulsed like WWV");
        }
        if let Some(last) = self.last_rise {
            if self.samples - last > 144_000 {
                self.lose_sync("No valid pulse cadence");
            }
        }
    }
    fn complete_pulse(&mut self) {
        self.pulse_ms = (self.samples - self.rise) as f32 / AUDIO_RATE as f32 * 1000.0;
        self.last_symbol = if (110.0..250.0).contains(&self.pulse_ms) {
            0
        } else if (410.0..550.0).contains(&self.pulse_ms) {
            1
        } else if (710.0..850.0).contains(&self.pulse_ms) {
            2
        } else {
            -2
        };
        if let Some(second) = self.second {
            self.bits[second as usize] = self.last_symbol;
            if second == 59 {
                match parse_frame(&self.bits) {
                    Ok(mut frame) => {
                        self.valid += 1;
                        if let (Some(previous), Some(last)) = (&self.frame, self.last_frame_sample)
                        {
                            let duration = (self.samples - last) as f64 / AUDIO_RATE;
                            if (59.8..60.2).contains(&duration)
                                && minute_number(&frame) == minute_number(previous) + 1
                            {
                                frame.consecutive_frames = previous.consecutive_frames + 1;
                                frame.confirmed = true;
                            }
                        }
                        self.confirmed = frame.confirmed;
                        self.frame = Some(frame);
                        self.last_frame_sample = Some(self.samples);
                        self.error = None;
                    }
                    Err(e) => {
                        self.rejected += 1;
                        self.confirmed = false;
                        self.error = Some(e);
                    }
                }
            }
        }
    }
    fn status(&self) -> String {
        // All timestamps/counters derive from received samples, never Date.now().
        serde_json::json!({ "samples": self.samples, "second": self.second,
            "synchronized":self.second.is_some(), "confirmed":self.confirmed,
            "pulseMs":self.pulse_ms, "symbol":self.last_symbol, "symbols":self.bits.to_vec(),
            "subcarrier":self.level, "validFrames":self.valid, "rejectedFrames":self.rejected,
            "frame":self.frame, "lastFrameSample":self.last_frame_sample, "error":self.error })
        .to_string()
    }
}

#[wasm_bindgen]
pub struct WwvDecoder {
    am: AmDemodulator,
    receiver: Receiver,
}
#[wasm_bindgen]
impl WwvDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(offset_hz: f64, bandwidth_hz: f64) -> Self {
        Self {
            am: AmDemodulator::new(offset_hz, bandwidth_hz),
            receiver: Receiver::new(),
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn process(&mut self, iq: &[u8]) -> Vec<f32> {
        let receiver = &mut self.receiver;
        self.am.process(iq, |am| receiver.feed(am))
    }
    /// Normalized F32 I/Q at 240 kSPS from dsp_core.
    pub fn process_baseband(&mut self, iq: &[f32]) -> Vec<f32> {
        let receiver = &mut self.receiver;
        self.am.process_baseband(iq, |am| receiver.feed(am))
    }
    /// Offline audio entry point for protocol verification / future WAV replay.
    /// Centered AM audio at exactly 48 kHz, before volume or de-emphasis.
    pub fn process_audio(&mut self, audio: &[f32]) {
        for sample in audio {
            self.receiver.feed(*sample);
        }
    }
    pub fn status(&self) -> String {
        self.receiver.status()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reference() -> [i8; 60] {
        // NIST diagram's explicit example: 2001 / day 173 / 21:10 / DUT1 +0.3.
        let mut bits = [0; 60];
        bits[0] = -1;
        for i in [9, 19, 29, 39, 49, 59] {
            bits[i] = 2;
        }
        for i in [4, 15, 20, 26, 30, 31, 35, 36, 37, 40, 50, 56, 57] {
            bits[i] = 1;
        }
        bits
    }
    fn minute_bits(minute: u8) -> [i8; 60] {
        let mut bits = reference();
        for i in [10, 11, 12, 13, 15, 16, 17] {
            bits[i] = 0;
        }
        for (n, i) in [10, 11, 12, 13].iter().enumerate() {
            bits[*i] = ((minute % 10 >> n) & 1) as i8;
        }
        for (n, i) in [15, 16, 17].iter().enumerate() {
            bits[*i] = ((minute / 10 >> n) & 1) as i8;
        }
        bits
    }
    #[test]
    fn nist_example_and_strict_calendar_marker_validation() {
        let bits = reference();
        let frame = parse_frame(&bits).unwrap();
        assert_eq!(
            (frame.year, frame.day_of_year, frame.hour, frame.minute),
            (2001, 173, 21, 10)
        );
        assert!((frame.dut1 - 0.3).abs() < 0.001);
        let mut bad = bits;
        bad[19] = 1;
        assert!(parse_frame(&bad).is_err());
        let mut bad = bits;
        bad[14] = 1;
        assert!(parse_frame(&bad).is_err());
        let mut bad = bits;
        bad[10] = 1;
        bad[11] = 1;
        bad[12] = 1;
        bad[13] = 1;
        assert!(parse_frame(&bad).is_err());
        let mut bad = bits;
        for i in [30, 31, 32, 33, 35, 36, 37, 38, 40, 41] {
            bad[i] = 0;
        }
        assert!(parse_frame(&bad).is_err());
    }
    #[test]
    fn decodes_pulsed_subcarrier_with_tones_noise_and_arbitrary_start_then_loses_lock() {
        let mut receiver = Receiver::new();
        let mut seed = 451u32;
        for n in 0..(123 * 48000) {
            let t = n as f64 / AUDIO_RATE;
            let absolute = t + 58.0;
            let minute = (absolute / 60.0).floor() as u8;
            let second = (absolute as usize) % 60;
            let fraction = absolute.fract();
            let bits = minute_bits(10 + minute);
            let width = match bits[second] {
                0 => 0.17,
                1 => 0.47,
                2 => 0.77,
                _ => 0.0,
            };
            let data = if fraction >= 0.03 && fraction < 0.03 + width {
                0.5 * (2.0 * PI * 100.0 * t + 0.8).sin()
            } else {
                0.0
            };
            let tone = 0.15 * (2.0 * PI * 500.0 * t).sin();
            let tick = if second == 0 && fraction < 0.8
                || second != 29 && second != 59 && fraction < 0.005
            {
                0.8 * (2.0 * PI * 1000.0 * t).sin()
            } else {
                0.0
            };
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let noise = 0.02 * (seed as f64 / u32::MAX as f64 - 0.5);
            receiver.feed((data + tone + tick + noise) as f32);
        }
        let frame = receiver.frame.as_ref().expect("No decoded frame");
        assert_eq!(
            (frame.year, frame.day_of_year, frame.hour, frame.minute),
            (2001, 173, 21, 12)
        );
        assert!(receiver.confirmed);
        assert_eq!(receiver.valid, 2);
        assert_eq!(receiver.rejected, 0);
        for _ in 0..(4 * 48000) {
            receiver.feed(0.0);
        }
        assert!(!receiver.confirmed);
        assert!(receiver.second.is_none());
        assert!(
            receiver.frame.is_some(),
            "Last decoded result is preserved with loss of sync indicated separately"
        );
    }
    #[test]
    fn noise_and_continuous_100_hz_do_not_produce_timestamps() {
        let mut noise = Receiver::new();
        let mut tone = Receiver::new();
        let mut seed = 184u32;
        for n in 0..(65 * 48000) {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            noise.feed((seed as f64 / u32::MAX as f64 - 0.5) as f32);
            tone.feed((0.5 * (2.0 * PI * 100.0 * n as f64 / AUDIO_RATE).sin()) as f32);
        }
        assert_eq!(noise.valid, 0);
        assert_eq!(tone.valid, 0);
        assert!(!noise.confirmed && !tone.confirmed);
    }
    #[test]
    fn am_iq_front_end_returns_correct_audio_and_preserves_chunk_state() {
        let count = 720000;
        let mut iq = Vec::with_capacity(count * 2);
        for n in 0..count {
            let t = n as f64 / 2_400_000.0;
            let a = 65.0 * (1.0 + 0.4 * (2.0 * PI * 600.0 * t).sin());
            let phase = 2.0 * PI * (-475000.0) * t;
            iq.push((127.5 + a * phase.cos()).round() as u8);
            iq.push((127.5 + a * phase.sin()).round() as u8);
        }
        let expected = WwvDecoder::new(-475000.0, 10000.0).process(&iq);
        let mut decoder = WwvDecoder::new(-475000.0, 10000.0);
        let actual: Vec<f32> = iq.chunks(12346).flat_map(|c| decoder.process(c)).collect();
        assert_eq!(expected, actual);
        assert_eq!(actual.len(), 28800);
        assert!(actual.chunks_exact(2).all(|c| c[0] == c[1]));
        let stable: Vec<f64> = actual
            .iter()
            .step_by(2)
            .skip(9600)
            .map(|v| *v as f64)
            .collect();
        let mut re = 0.0;
        let mut im = 0.0;
        for (n, v) in stable.iter().enumerate() {
            let p = 2.0 * PI * 600.0 * n as f64 / AUDIO_RATE;
            re += v * p.cos();
            im += v * p.sin();
        }
        assert!(2.0 * re.hypot(im) / stable.len() as f64 > 0.15);
    }
}
