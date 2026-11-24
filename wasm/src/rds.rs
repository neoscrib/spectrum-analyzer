//! RDS/RBDS data-stream 0 from the real, deviation-normalized FM multiplex.
//! NRSC-4 / IEC 62106: 57 kHz, differential biphase at 1187.5 bit/s,
//! shortened cyclic (26,16) blocks with A/B/C(C')/D offset words.
use super::{Fir, IF_RATE, lowpass};
use serde::Serialize;
use std::f64::consts::PI;

const BIT_RATE: f64 = 1187.5;
const BASE_RATE: f64 = IF_RATE / 10.0;
const OFFSETS: [u32; 5] = [0x0fc, 0x198, 0x168, 0x1b4, 0x350];

fn remainder(mut word: u32) -> u32 {
    for bit in (10..26).rev() {
        if word & (1 << bit) != 0 {
            word ^= 0x5b9 << (bit - 10);
        }
    }
    word & 0x3ff
}

#[derive(Default)]
struct BlockSync {
    shift: u32,
    filled: usize,
    block: usize,
    remaining: usize,
    words: [u16; 4],
}
impl BlockSync {
    fn bit(&mut self, bit: bool) -> Option<[u16; 4]> {
        self.shift = ((self.shift << 1) | bit as u32) & 0x3ff_ffff;
        self.filled = (self.filled + 1).min(26);
        if self.filled < 26 {
            return None;
        }
        if self.remaining != 0 {
            self.remaining -= 1;
            if self.remaining != 0 {
                return None;
            }
            let index = if self.block == 2 && self.words[1] & 0x0800 != 0 {
                4
            } else {
                self.block
            };
            let valid = remainder(self.shift) == OFFSETS[index]
                && (index != 4 || (self.shift >> 10) as u16 == self.words[0]);
            if valid {
                self.words[self.block] = (self.shift >> 10) as u16;
                self.block += 1;
                if self.block == 4 {
                    self.block = 0;
                    return Some(self.words);
                }
                self.remaining = 26;
                return None;
            }
            self.block = 0;
        }
        if remainder(self.shift) == OFFSETS[0] {
            self.words[0] = (self.shift >> 10) as u16;
            self.block = 1;
            self.remaining = 26;
        }
        None
    }
}

struct Timing {
    phase: f64,
    integral: [f64; 2],
    previous: Option<[f64; 2]>,
    sync: BlockSync,
}
impl Timing {
    fn new(phase: f64) -> Self {
        Self {
            phase,
            integral: [0.0; 2],
            previous: None,
            sync: BlockSync::default(),
        }
    }
    fn sample(&mut self, re: f64, im: f64) -> Option<[u16; 4]> {
        let sign = if self.phase < 0.5 { 1.0 } else { -1.0 };
        self.integral[0] += sign * re;
        self.integral[1] += sign * im;
        self.phase += BIT_RATE / BASE_RATE;
        if self.phase < 1.0 {
            return None;
        }
        self.phase -= 1.0;
        let symbol = std::mem::replace(&mut self.integral, [0.0; 2]);
        let previous = self.previous.replace(symbol)?;
        // Complex differential detection removes arbitrary carrier phase and
        // polarity, and tolerates small carrier error without a pilot PLL.
        self.sync
            .bit(symbol[0] * previous[0] + symbol[1] * previous[1] < 0.0)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockTime {
    mjd: u32,
    hour: u16,
    minute: u16,
    offset_minutes: i16,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdsStatus {
    pub enabled: bool,
    pub synchronized: bool,
    pub valid_groups: u64,
    pub seconds_since_group: Option<f64>,
    pub pi: Option<u16>,
    pub ps: Option<String>,
    pub radio_text: Option<String>,
    pub pty: Option<u8>,
    pub tp: Option<bool>,
    pub ta: Option<bool>,
    pub music: Option<bool>,
    pub clock: Option<ClockTime>,
    pub group_types: [u32; 32],
    pub last_group: Option<[u16; 4]>,
}

#[derive(Default)]
struct Station {
    pi: Option<u16>,
    ps: Option<String>,
    ps_bytes: [u8; 8],
    ps_seen: u8,
    ps_repeat: u8,
    radio_text: Option<String>,
    rt_bytes: Vec<u8>,
    rt_seen: u16,
    rt_flag: Option<(bool, bool)>,
    pty: Option<u8>,
    tp: Option<bool>,
    ta: Option<bool>,
    music: Option<bool>,
    clock: Option<ClockTime>,
    group_types: [u32; 32],
    last_group: Option<[u16; 4]>,
}

fn text(bytes: &[u8]) -> String {
    // IEC/EN basic G0 character repertoire. Mapping cross-checked against
    // redsea (Oona Räisänen, MIT); see public/licenses/redsea-MIT.txt.
    const EXTENDED: &str = concat!(
        "áàéèíìóòúùÑÇŞβ¡Ĳ",
        "âäêëîïôöûüñçşǧıĳ",
        "ªα©‰Ǧěňőπ€£$←↑→↓",
        "º¹²³±İńűµ¿÷°¼½¾§",
        "ÁÀÉÈÍÌÓÒÚÙŘČŠŽÐĿ",
        "ÂÄÊËÎÏÔÖÛÜřčšžđŀ",
        "ÃÅÆŒŷÝÕØÞŊŔĆŚŹŦð",
        "ãåæœŵýõøþŋŕćśźŧ ",
    );
    bytes
        .iter()
        .map(|&byte| match byte {
            0x0a => '\n',
            0x24 => '¤',
            0x5e => '―',
            0x60 => '‖',
            0x7e => '¯',
            0x20..=0x7d => byte as char,
            0x80..=0xff => EXTENDED.chars().nth((byte - 0x80) as usize).unwrap_or(' '),
            // Unrecognized control codes are displayed as spaces, per NRSC-4-B.
            _ => ' ',
        })
        .collect::<String>()
        .trim_end()
        .to_string()
}

impl Station {
    fn group(&mut self, words: [u16; 4]) {
        let [pi, b, c, d] = words;
        self.pi = Some(pi);
        let kind = (b >> 12) as usize;
        let version_b = b & 0x0800 != 0;
        self.group_types[kind * 2 + version_b as usize] =
            self.group_types[kind * 2 + version_b as usize].saturating_add(1);
        self.last_group = Some(words);
        self.pty = Some(((b >> 5) & 31) as u8);
        self.tp = Some(b & 0x0400 != 0);
        match kind {
            0 => {
                self.ta = Some(b & 0x10 != 0);
                self.music = Some(b & 8 != 0);
                let segment = (b & 3) as usize;
                let pair = d.to_be_bytes();
                let bit = 1 << segment;
                if self.ps_seen & bit != 0 && self.ps_bytes[segment * 2..segment * 2 + 2] == pair {
                    self.ps_repeat |= bit;
                } else {
                    self.ps_bytes[segment * 2..segment * 2 + 2].copy_from_slice(&pair);
                    self.ps_repeat &= !bit;
                }
                self.ps_seen |= bit;
                if self.ps_repeat == 15 {
                    self.ps = Some(text(&self.ps_bytes));
                }
            }
            2 => {
                let flag = (b & 0x10 != 0, version_b);
                if self.rt_flag != Some(flag) {
                    self.rt_flag = Some(flag);
                    self.rt_seen = 0;
                    self.rt_bytes = vec![b' '; if version_b { 32 } else { 64 }];
                    self.radio_text = None;
                }
                let segment = (b & 15) as usize;
                let bytes = if version_b {
                    d.to_be_bytes().to_vec()
                } else {
                    [c.to_be_bytes(), d.to_be_bytes()].concat()
                };
                let at = segment * bytes.len();
                self.rt_bytes[at..at + bytes.len()].copy_from_slice(&bytes);
                self.rt_seen |= 1 << segment;
                let end = self.rt_bytes.iter().position(|&b| b == 0x0d);
                let needed = end.map(|end| end / bytes.len() + 1).unwrap_or(16);
                let mask = ((1u32 << needed) - 1) as u16;
                if self.rt_seen & mask == mask {
                    self.radio_text =
                        Some(text(&self.rt_bytes[..end.unwrap_or(self.rt_bytes.len())]));
                }
            }
            4 if !version_b => {
                let mjd = ((b as u32 & 3) << 15) | (c as u32 >> 1);
                let hour = ((c & 1) << 4) | (d >> 12);
                let minute = (d >> 6) & 63;
                if mjd <= 99999 && hour < 24 && minute < 60 {
                    let sign = if d & 0x20 != 0 { -1 } else { 1 };
                    self.clock = Some(ClockTime {
                        mjd,
                        hour,
                        minute,
                        offset_minutes: sign * (d as i16 & 31) * 30,
                    });
                }
            }
            _ => {}
        }
    }
}

pub struct RdsDecoder {
    osc: [f64; 2],
    step: [f64; 2],
    filter_i: Fir,
    filter_q: Fir,
    timing: Vec<Timing>,
    samples: u64,
    last_accepted: Option<u64>,
    candidate_pi: Option<u16>,
    candidate_count: u32,
    last_station: Option<u64>,
    valid_groups: u64,
    station: Station,
}
impl RdsDecoder {
    pub fn new() -> Self {
        let phase = 2.0 * PI * 57000.0 / IF_RATE;
        let taps = lowpass(401, 2600.0, IF_RATE);
        Self {
            osc: [1.0, 0.0],
            step: [phase.cos(), phase.sin()],
            filter_i: Fir::new(taps.clone()),
            filter_q: Fir::new(taps),
            // Parallel timing hypotheses remain active while receiving. As a
            // source clock drifts, CRC-valid groups select the useful phase;
            // duplicate groups from neighboring hypotheses are suppressed.
            timing: (0..16).map(|n| Timing::new(n as f64 / 16.0)).collect(),
            samples: 0,
            last_accepted: None,
            candidate_pi: None,
            candidate_count: 0,
            last_station: None,
            valid_groups: 0,
            station: Station::default(),
        }
    }

    pub fn process(&mut self, fm: f32) {
        self.samples += 1;
        self.filter_i.push((fm as f64 * self.osc[0]) as f32);
        self.filter_q.push((-fm as f64 * self.osc[1]) as f32);
        self.osc = [
            self.osc[0] * self.step[0] - self.osc[1] * self.step[1],
            self.osc[0] * self.step[1] + self.osc[1] * self.step[0],
        ];
        if self.samples % 4096 == 0 {
            let norm = self.osc[0].hypot(self.osc[1]);
            self.osc[0] /= norm;
            self.osc[1] /= norm;
        }
        if self.samples % 10 != 0 {
            return;
        }
        let (re, im) = (self.filter_i.value() as f64, self.filter_q.value() as f64);
        for n in 0..self.timing.len() {
            if let Some(group) = self.timing[n].sample(re, im) {
                self.accept(group);
            }
        }
    }

    fn accept(&mut self, words: [u16; 4]) {
        if self
            .last_accepted
            .is_some_and(|at| ((self.samples - at) as f64) < IF_RATE / BIT_RATE * 52.0)
        {
            return;
        }
        let recent = self
            .last_accepted
            .is_some_and(|at| self.samples - at < (IF_RATE * 2.0) as u64);
        self.last_accepted = Some(self.samples);
        self.valid_groups += 1;
        if self.candidate_pi == Some(words[0]) && recent {
            self.candidate_count = self.candidate_count.saturating_add(1);
        } else {
            self.candidate_pi = Some(words[0]);
            self.candidate_count = 1;
        }
        if self.candidate_count < 2 {
            return;
        }
        if self.station.pi != Some(words[0]) {
            self.station = Station::default();
        }
        self.station.group(words);
        self.last_station = Some(self.samples);
    }

    pub fn status(&self) -> RdsStatus {
        let age = self
            .last_station
            .map(|at| (self.samples - at) as f64 / IF_RATE);
        RdsStatus {
            enabled: true,
            synchronized: self.candidate_count >= 2
                && self.candidate_pi == self.station.pi
                && age.is_some_and(|age| age < 2.0),
            valid_groups: self.valid_groups,
            seconds_since_group: age,
            pi: self.station.pi,
            ps: self.station.ps.clone(),
            radio_text: self.station.radio_text.clone(),
            pty: self.station.pty,
            tp: self.station.tp,
            ta: self.station.ta,
            music: self.station.music,
            clock: self.station.clock.clone(),
            group_types: self.station.group_types,
            last_group: self.station.last_group,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn encoded(words: [u16; 4]) -> Vec<bool> {
        words
            .iter()
            .enumerate()
            .flat_map(|(index, &word)| {
                let offset = if index == 2 && words[1] & 0x800 != 0 {
                    OFFSETS[4]
                } else {
                    OFFSETS[index]
                };
                let code = ((word as u32) << 10) | (remainder((word as u32) << 10) ^ offset);
                (0..26).rev().map(move |bit| code & (1 << bit) != 0)
            })
            .collect()
    }
    #[test]
    fn published_crc_vector_and_corruption_rejection() {
        // Independent transmitted vector from redsea's MIT-licensed bit tests:
        // https://github.com/windytan/redsea/blob/master/test/components-bits.cc
        let blocks = [
            (0x22e1u32 << 10) | 0b0111001100,
            (0x2583u32 << 10) | 0b1100111110,
            (0x2065u32 << 10) | 0b1011010011,
            (0x6920u32 << 10) | 0b0110111110,
        ];
        for (n, word) in blocks.iter().enumerate() {
            assert_eq!(remainder(*word), OFFSETS[n]);
        }
        let mut sync = BlockSync::default();
        let bits: Vec<bool> = blocks
            .iter()
            .flat_map(|word| (0..26).rev().map(move |bit| word & (1 << bit) != 0))
            .collect();
        let groups: Vec<_> = bits
            .iter()
            .copied()
            .filter_map(|bit| sync.bit(bit))
            .collect();
        assert_eq!(groups, vec![[0x22e1, 0x2583, 0x2065, 0x6920]]);
        for flipped in 0..104 {
            let mut corrupt = bits.clone();
            corrupt[flipped] = !corrupt[flipped];
            let mut sync = BlockSync::default();
            assert!(
                corrupt
                    .into_iter()
                    .filter_map(|bit| sync.bit(bit))
                    .next()
                    .is_none()
            );
        }
    }
    #[test]
    fn demodulates_arbitrary_phase_and_clock_offset_without_stereo_pilot() {
        let group = [0x1234, 0x0408, 0x0000, 0x5445];
        let bits = encoded(group);
        for (phase, ppm, offset, seconds) in [
            (0.0, 0.0, 0.0, 2.0),
            (1.3, 40.0, 12.0, 2.0),
            (2.7, -50.0, -15.0, 2.0),
            (0.8, 500.0, 28.5, 8.0),
        ] {
            let mut decoder = RdsDecoder::new();
            let mut differential = vec![false];
            for bit in bits.iter().cycle().take(12000) {
                differential.push(differential.last().unwrap() ^ bit);
            }
            for n in 0..(IF_RATE * seconds) as usize {
                let t = n as f64 / IF_RATE;
                let position = t * BIT_RATE * (1.0 + ppm * 1e-6) + 0.37;
                let sign = if differential[position as usize] {
                    1.0
                } else {
                    -1.0
                } * if position.fract() < 0.5 { 1.0 } else { -1.0 };
                let fm = 0.03 * sign * (2.0 * PI * (57000.0 + offset) * t + phase).cos()
                    + 0.3 * (2.0 * PI * 1000.0 * t).sin();
                decoder.process(fm as f32);
            }
            let status = decoder.status();
            assert!(
                status.synchronized,
                "no RDS lock: phase={phase}, ppm={ppm}, offset={offset}, groups={}",
                status.valid_groups
            );
            assert_eq!(status.pi, Some(0x1234));
            assert!(status.valid_groups > (seconds * 6.0) as u64);
        }
    }

    #[test]
    fn no_lock_for_noise_or_a_57khz_reference_tone_and_lock_expires() {
        let mut noise = RdsDecoder::new();
        let mut tone = RdsDecoder::new();
        let mut seed = 12345u32;
        for n in 0..240_000 {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            noise.process((seed as f64 / u32::MAX as f64 - 0.5) as f32);
            tone.process((0.05 * (2.0 * PI * 57000.0 * n as f64 / IF_RATE).sin()) as f32);
        }
        assert_eq!(noise.status().valid_groups, 0);
        assert_eq!(tone.status().valid_groups, 0);
        let mut decoder = RdsDecoder::new();
        for words in [[0x1234, 0x0408, 0, 0x4142]; 2] {
            decoder.samples += 22000;
            decoder.accept(words);
        }
        assert!(decoder.status().synchronized);
        decoder.samples += 480001;
        assert!(!decoder.status().synchronized);
        assert_eq!(decoder.status().pi, Some(0x1234)); // Labeled as last decoded.
        for _ in 0..2 {
            decoder.samples += 22000;
            decoder.accept([0x5678, 0x0408, 0, 0x4344]);
        }
        assert_eq!(decoder.status().pi, Some(0x5678));
        assert!(decoder.status().ps.is_none());
        assert!(decoder.status().radio_text.is_none());
    }

    #[test]
    fn c_prime_ps_confirmation_radiotext_flags_and_clock_validation() {
        let mut sync = BlockSync::default();
        let correct = [0x1234, 0x0c08, 0x1234, 0x4142];
        let result: Vec<_> = encoded(correct)
            .into_iter()
            .filter_map(|bit| sync.bit(bit))
            .collect();
        assert_eq!(result, vec![correct]);
        let mut sync = BlockSync::default();
        assert!(
            encoded([0x1234, 0x0c08, 0x5678, 0x4142])
                .into_iter()
                .filter_map(|bit| sync.bit(bit))
                .next()
                .is_none()
        );

        let mut station = Station::default();
        for repeat in 0..2 {
            for (index, pair) in b"SPECTRUM".chunks_exact(2).enumerate() {
                station.group([
                    0x1234,
                    0x0548 | index as u16,
                    0,
                    u16::from_be_bytes([pair[0], pair[1]]),
                ]);
            }
            assert_eq!(station.ps.is_some(), repeat == 1);
        }
        assert_eq!(station.ps.as_deref(), Some("SPECTRUM"));
        assert_eq!(station.pty, Some(10));
        assert_eq!(station.tp, Some(true));
        assert_eq!(station.ta, Some(false));
        // Out-of-order 2A segments must not publish until the prefix is present.
        station.group([0x1234, 0x2001, 0x4f0d, 0x2020]);
        assert!(station.radio_text.is_none());
        station.group([0x1234, 0x2000, 0x4845, 0x4c4c]);
        assert_eq!(station.radio_text.as_deref(), Some("HELLO"));
        station.group([0x1234, 0x2010, 0x4e45, 0x5720]);
        assert!(station.radio_text.is_none()); // Text A/B change clears old text.
        station.group([0x1234, 0x2810, 0x1234, 0x4142]);
        station.group([0x1234, 0x2811, 0x1234, 0x430d]);
        assert_eq!(station.radio_text.as_deref(), Some("ABC"));
        assert_eq!(text(&[0x80, 0x8f, 0xa9, 0xaf]), "áĲ€↓");
        // CT: MJD 61368, 18:30 UTC, local offset -6 hours.
        let mjd = 61368u32;
        station.group([
            0x1234,
            0x4000 | (mjd >> 15) as u16,
            ((mjd & 0x7fff) << 1) as u16 | 1,
            0x2000 | (30 << 6) | 0x20 | 12,
        ]);
        let clock = station.clock.as_ref().unwrap();
        assert_eq!(
            (clock.mjd, clock.hour, clock.minute, clock.offset_minutes),
            (mjd, 18, 30, -360)
        );
        station.clock = None;
        station.group([0x1234, 0x4000, 0, 63 << 6]);
        assert!(station.clock.is_none());
    }
}
