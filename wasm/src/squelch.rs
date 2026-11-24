//! Receive-only CTCSS/DCS detection at 1,200 samples/s, from the FM discriminator.
//! Format: ETSI TS 103 236. DCS uses Golay(23,12), LSB first, fixed data bits 100.
use serde::Serialize;
use std::f64::consts::PI;

pub const CTCSS: [f32; 50] = [
    67., 69.3, 71.9, 74.4, 77., 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100., 103.5, 107.2,
    110.9, 114.8, 118.8, 123., 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2,
    165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5,
    206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1,
];
pub const DCS_CODES: [u16; 83] = [
    0o023, 0o025, 0o026, 0o031, 0o032, 0o043, 0o047, 0o051, 0o054, 0o065, 0o071, 0o072, 0o073,
    0o074, 0o114, 0o115, 0o116, 0o125, 0o131, 0o132, 0o134, 0o143, 0o152, 0o155, 0o156, 0o162,
    0o165, 0o172, 0o174, 0o205, 0o223, 0o226, 0o243, 0o244, 0o245, 0o251, 0o261, 0o263, 0o265,
    0o271, 0o306, 0o311, 0o315, 0o331, 0o343, 0o346, 0o351, 0o364, 0o365, 0o371, 0o411, 0o412,
    0o413, 0o423, 0o431, 0o432, 0o445, 0o464, 0o465, 0o466, 0o503, 0o506, 0o516, 0o532, 0o546,
    0o565, 0o606, 0o612, 0o624, 0o627, 0o631, 0o632, 0o654, 0o662, 0o664, 0o703, 0o712, 0o723,
    0o731, 0o732, 0o734, 0o743, 0o754,
];
#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct DcsCode {
    pub code: String,
    pub inverted: bool,
}
pub fn dcs_word(code: u16) -> u32 {
    let data = 0x800 | code;
    let mut remainder = (data as u32) << 11;
    for bit in (11..=22).rev() {
        if remainder & (1 << bit) != 0 {
            remainder ^= 0xc75 << (bit - 11);
        }
    }
    (remainder << 12) | data as u32
}
fn rotate(word: u32, n: u32) -> u32 {
    ((word >> n) | (word << (23 - n))) & 0x7fffff
}
fn canonical(word: u32) -> u32 {
    (0..23).map(|n| rotate(word, n)).min().unwrap()
}
struct BitLane {
    phase: u32,
    sum: f64,
    count: u32,
    word: u32,
    bits: u32,
    class: Option<usize>,
    streak: u32,
}
impl BitLane {
    fn new(phase: u32) -> Self {
        Self {
            phase,
            sum: 0.,
            count: 0,
            word: 0,
            bits: 0,
            class: None,
            streak: 0,
        }
    }
}
pub struct CodeDetector {
    samples: u64,
    ring: [f32; 960],
    pos: usize,
    filled: usize,
    coefficients: Vec<[f64; 5]>,
    ctcss: Option<f32>,
    candidate: Option<f32>,
    confirm: u8,
    classes: Vec<Vec<DcsCode>>,
    patterns: Vec<(u32, usize)>,
    lanes: Vec<BitLane>,
    dcs: Vec<DcsCode>,
    last_dcs: u64,
}
impl CodeDetector {
    pub fn new() -> Self {
        let coefficients = CTCSS
            .iter()
            .map(|f| {
                [-0.005, -0.0025, 0., 0.0025, 0.005]
                    .map(|offset| 2. * (2. * PI * (*f as f64) * (1. + offset) / 1200.).cos())
            })
            .collect();
        let mut words = Vec::<u32>::new();
        let mut classes = Vec::<Vec<DcsCode>>::new();
        for code in DCS_CODES {
            for inverted in [false, true] {
                let word = canonical(dcs_word(code) ^ if inverted { 0x7fffff } else { 0 });
                let index = words.iter().position(|w| *w == word).unwrap_or_else(|| {
                    words.push(word);
                    classes.push(vec![]);
                    words.len() - 1
                });
                classes[index].push(DcsCode {
                    code: format!("{code:03o}"),
                    inverted,
                });
            }
        }
        let patterns = words
            .iter()
            .enumerate()
            .flat_map(|(index, w)| (0..23).map(move |n| (rotate(*w, n), index)))
            .collect();
        Self {
            samples: 0,
            ring: [0.; 960],
            pos: 0,
            filled: 0,
            coefficients,
            ctcss: None,
            candidate: None,
            confirm: 0,
            classes,
            patterns,
            lanes: (0..8).map(|n| BitLane::new(n * 125 / 8)).collect(),
            dcs: vec![],
            last_dcs: 0,
        }
    }
    pub fn reset(&mut self) {
        self.filled = 0;
        self.pos = 0;
        self.ctcss = None;
        self.candidate = None;
        self.confirm = 0;
        self.dcs.clear();
        for (i, l) in self.lanes.iter_mut().enumerate() {
            *l = BitLane::new(i as u32 * 125 / 8);
        }
    }
    pub fn ctcss(&self) -> Option<f32> {
        if self.dcs.is_empty() {
            self.ctcss
        } else {
            None
        }
    }
    pub fn dcs(&self) -> Vec<DcsCode> {
        self.dcs.clone()
    }
    pub fn push(&mut self, value: f32) {
        self.samples += 1;
        self.ring[self.pos] = value;
        self.pos = (self.pos + 1) % 960;
        self.filled = (self.filled + 1).min(960);
        for lane in &mut self.lanes {
            lane.sum += value as f64;
            lane.count += 1;
            lane.phase += 14;
            if lane.phase < 125 {
                continue;
            }
            lane.phase -= 125;
            lane.word = (lane.word >> 1) | if lane.sum > 0. { 1 << 22 } else { 0 };
            lane.sum = 0.;
            lane.count = 0;
            lane.bits += 1;
            // A complete repeated word every 23 bits. All cyclic alignments are
            // considered; four successive matching words are required to lock.
            if lane.bits % 23 != 0 {
                continue;
            }
            let mut best = None;
            let mut errors = 2;
            for (word, class) in &self.patterns {
                let e = (lane.word ^ word).count_ones();
                if e < errors {
                    errors = e;
                    best = Some(*class);
                }
            }
            if best.is_some() && best == lane.class {
                lane.streak += 1;
            } else {
                lane.streak = u32::from(best.is_some());
                lane.class = best;
            }
            if lane.streak >= 4 {
                self.dcs = self.classes[best.unwrap()].clone();
                self.last_dcs = self.samples;
            }
        }
        if self.samples.saturating_sub(self.last_dcs) > 480 {
            self.dcs.clear();
        }
        if self.filled < 960 || self.samples % 240 != 0 {
            return;
        }
        let mean = self.ring.iter().map(|v| *v as f64).sum::<f64>() / 960.;
        // Unwrap/center the window once, rather than doing circular indexing
        // again for every tone and frequency-tolerance candidate.
        let mut window = [0.0f64; 960];
        for (out, value) in window
            .iter_mut()
            .zip(self.ring[self.pos..].iter().chain(&self.ring[..self.pos]))
        {
            *out = *value as f64 - mean;
        }
        let energy = window.iter().map(|v| v * v).sum::<f64>();
        let mut scores = Vec::with_capacity(CTCSS.len());
        for (index, coeffs) in self.coefficients.iter().enumerate() {
            let mut best = 0f64;
            let mut a = [0.0f64; 5];
            let mut b = [0.0f64; 5];
            // Independent recurrences keep the five tolerance candidates in
            // flight together; their individual arithmetic/order is unchanged.
            for x in &window {
                for j in 0..5 {
                    let next = x + coeffs[j] * a[j] - b[j];
                    b[j] = a[j];
                    a[j] = next;
                }
            }
            for j in 0..5 {
                best = best.max(a[j] * a[j] + b[j] * b[j] - coeffs[j] * a[j] * b[j]);
            }
            scores.push((index, best));
        }
        scores.sort_by(|a, b| b.1.total_cmp(&a.1));
        let (index, power) = scores[0];
        let coherence = 2. * power / (960. * energy.max(1e-9));
        let amplitude = 2. * power.max(0.).sqrt() / 960.;
        let found = if coherence > 0.60 && amplitude > 20. && power > scores[1].1 * 1.6 {
            Some(CTCSS[index])
        } else {
            None
        };
        if found.is_some() && found == self.candidate {
            self.confirm = self.confirm.saturating_add(1);
        } else {
            self.candidate = found;
            self.confirm = u8::from(found.is_some());
        }
        self.ctcss = if self.confirm >= 2 { found } else { None };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dcs_published_words_and_polarity_aliases() {
        assert_eq!(dcs_word(0o023), 0b11101100011100000010011);
        assert_eq!(dcs_word(0o025), 0b11010110111100000010101);
        assert_eq!(
            canonical(dcs_word(0o023)),
            canonical(dcs_word(0o047) ^ 0x7fffff)
        );
    }
    #[test]
    fn detects_tones_rejects_voice_and_releases() {
        for hz in [67., 100., 162.2, 254.1] {
            let mut d = CodeDetector::new();
            for n in 0..1800 {
                d.push(
                    (250. * (2. * PI * hz * n as f64 / 1200.).sin()
                        + 25. * (2. * PI * 330. * n as f64 / 1200.).sin())
                        as f32,
                );
            }
            assert_eq!(d.ctcss(), Some(hz as f32));
            assert!(d.dcs().is_empty());
            d.reset();
            assert_eq!(d.ctcss(), None);
        }
        let mut d = CodeDetector::new();
        for n in 0..2400 {
            d.push((500. * (2. * PI * 320. * n as f64 / 1200.).sin()) as f32);
        }
        assert_eq!(d.ctcss(), None);
        assert!(d.dcs().is_empty());
    }
    #[test]
    fn dcs_decodes_both_polarities_with_arbitrary_start() {
        for inverted in [false, true] {
            let mut d = CodeDetector::new();
            let word = dcs_word(0o023) ^ if inverted { 0x7fffff } else { 0 };
            for n in 0..2400 {
                let bit = (((n as f64 + 123.4) * 134.4 / 1200.) as usize) % 23;
                d.push(if (word >> bit) & 1 != 0 { 400. } else { -400. });
            }
            assert!(d.dcs().contains(&DcsCode {
                code: "023".into(),
                inverted
            }));
            assert_eq!(d.ctcss(), None);
        }
    }
}
