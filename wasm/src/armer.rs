//! Adapted from ~/code/armer/web/wasm/src/lib.rs (user-provided reference).
//! Receive-only P25 Phase I pipeline. The upstream p25 crate owns FEC and IMBE.
//! Our DSP performs digital downconversion, channel filtering and C4FM slicing.
use p25::{
    fec,
    frame::{self, Duid, IdenTable, LcKind, NidDecoder, StatusFilter, Tsbk, TsbkKind},
    trellis,
    voice::VoicePipeline,
};
use serde::Serialize;
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;
mod activity;
mod information;

const FS: u64 = 0x5575F5FF77FF;
const SIGN_SYNC: u32 = 0x04CF5F;
const LEVELS: [f32; 4] = [-1800., -600., 600., 1800.];

#[derive(Serialize, Clone, Debug)]
pub struct StationIdentification {
    pub callsign: String,
    pub valid: bool,
    pub channel: u16,
    pub frequency: u32,
}
#[derive(Serialize, Clone, Debug)]
pub struct ControlInformation {
    pub opcode: u8,
    pub mfid: u8,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station: Option<StationIdentification>,
}
#[derive(Serialize, Clone, Default, Debug)]
pub struct Event {
    pub kind: String,
    pub frequency: u32,
    pub talkgroup: u16,
    pub source: u32,
    pub channel: u16,
    pub encrypted: Option<bool>,
    pub message: String,
    pub nac: u16,
    pub system: u16,
    pub wacn: u32,
    pub rfss: u8,
    pub site: u8,
    pub members: Vec<u16>,
    pub corrections: u32,
    pub time: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control: Option<ControlInformation>,
}
fn event(kind: &str, hz: u32) -> Event {
    Event {
        kind: kind.into(),
        frequency: hz,
        ..Default::default()
    }
}
struct Frame {
    duid: Duid,
    nac: u16,
    correction: u8,
    data: Vec<u8>,
    soft: Vec<f32>,
    end: u64,
    score: f32,
}
struct Lane {
    seen: u64,
    active: bool,
    inverted: bool,
    status: StatusFilter,
    nid: u64,
    count: usize,
    duid: Option<Duid>,
    nac: u16,
    correction: u8,
    data: Vec<u8>,
    soft: Vec<f32>,
    blocks: u8,
    signs: u32,
    history: [f32; 24],
    mid: f32,
    scale: f32,
}
impl Lane {
    fn new() -> Self {
        Self {
            seen: 0,
            active: false,
            inverted: false,
            status: StatusFilter::after_sync(),
            nid: 0,
            count: 0,
            duid: None,
            nac: 0,
            correction: 0,
            data: Vec::with_capacity(800),
            soft: Vec::with_capacity(800),
            blocks: 0,
            signs: 0,
            history: [0.; 24],
            mid: 0.,
            scale: 1.,
        }
    }
    fn push(&mut self, value: f32, clock: u64, nid: &NidDecoder) -> Option<Frame> {
        self.history[(self.seen % 24) as usize] = value;
        self.signs = ((self.signs << 1) | u32::from(value < 0.)) & 0xFFFFFF;
        self.seen += 1;
        let normal = (self.signs ^ SIGN_SYNC).count_ones();
        let inv = (self.signs ^ (SIGN_SYNC ^ 0xFFFFFF)).count_ones();
        if self.seen >= 24 && (normal.min(inv) == 0 || (!self.active && normal.min(inv) <= 3)) {
            self.active = true;
            self.inverted = inv < normal;
            self.status = StatusFilter::after_sync();
            self.nid = 0;
            self.count = 0;
            self.duid = None;
            self.data.clear();
            self.soft.clear();
            self.blocks = 0;
            let mut p = 0.;
            let mut n = 0.;
            let mut pc = 0.;
            let mut nc = 0.;
            for i in 0..24 {
                let v = self.history[((self.seen + i) % 24) as usize]
                    * if self.inverted { -1. } else { 1. };
                if (FS >> (46 - i * 2)) & 2 == 0 {
                    p += v;
                    pc += 1.;
                } else {
                    n += v;
                    nc += 1.;
                }
            }
            let pos = p / pc;
            let neg = n / nc;
            self.mid = (pos + neg) / 2.;
            self.scale = (3600. / (pos - neg)).clamp(0.5, 3.);
            return None;
        }
        if !self.active {
            return None;
        }
        let v = ((if self.inverted { -value } else { value }) - self.mid) * self.scale;
        let d = if v > 1200. {
            1
        } else if v > 0. {
            0
        } else if v > -1200. {
            2
        } else {
            3
        };
        self.status.push(d)?;
        if self.duid.is_none() {
            self.nid = (self.nid << 2) | d as u64;
            self.count += 1;
            if self.count == 32 {
                match nid.decode(self.nid) {
                    Some(n) if n.fec_corrections <= 8 => {
                        self.duid = Some(n.duid);
                        self.nac = n.nac;
                        self.correction = n.fec_corrections;
                        if !matches!(
                            n.duid,
                            Duid::Tsdu | Duid::Ldu1 | Duid::Ldu2 | Duid::Hdu | Duid::Tdu
                        ) {
                            self.active = false;
                        }
                        if n.duid == Duid::Tdu {
                            self.active = false;
                            return Some(Frame {
                                duid: n.duid,
                                nac: n.nac,
                                correction: n.fec_corrections,
                                data: vec![],
                                soft: vec![],
                                end: clock,
                                score: n.fec_corrections as f32,
                            });
                        }
                    }
                    _ => self.active = false,
                }
            }
            return None;
        }
        self.data.push(d);
        self.soft.push(v);
        let duid = self.duid.unwrap();
        let length = match duid {
            Duid::Tsdu => 98,
            Duid::Hdu => 324,
            Duid::Ldu1 | Duid::Ldu2 => 784,
            _ => 0,
        };
        if self.data.len() != length {
            return None;
        }
        let score = self
            .soft
            .iter()
            .map(|v| {
                LEVELS
                    .iter()
                    .map(|l| (v - l).abs())
                    .fold(f32::INFINITY, f32::min)
            })
            .sum::<f32>()
            / length as f32
            + self.correction as f32 * 100.;
        let out = Frame {
            duid,
            nac: self.nac,
            correction: self.correction,
            data: std::mem::take(&mut self.data),
            soft: std::mem::take(&mut self.soft),
            end: clock,
            score,
        };
        if duid == Duid::Tsdu {
            self.blocks += 1;
            if self.blocks >= 3 {
                self.active = false;
            }
        } else {
            self.active = false;
        }
        Some(out)
    }
}

/// A symbol-aligned FM detector. All five phases compete using the same CRC;
/// no failed block is accepted merely because its slicer distance is small.
struct SymbolDecoder {
    previous: [f64; 2],
    fm: [f32; 5],
    fm_pos: usize,
    dc: f32,
    lanes: Vec<Lane>,
}
impl SymbolDecoder {
    fn new() -> Self {
        Self {
            previous: [0.; 2],
            fm: [0.; 5],
            fm_pos: 0,
            dc: 0.,
            lanes: (0..5).map(|_| Lane::new()).collect(),
        }
    }
    fn push(&mut self, z: [f64; 2], clock: u64, nid: &NidDecoder) -> Option<Frame> {
        let cross = self.previous[0] * z[1] - self.previous[1] * z[0];
        let dot = self.previous[0] * z[0] + self.previous[1] * z[1];
        self.previous = z;
        let hz = (cross.atan2(dot) * 24000. / (2. * PI)) as f32;
        self.dc += 0.00015 * (hz - self.dc);
        self.fm[self.fm_pos] = hz - self.dc;
        self.fm_pos = (self.fm_pos + 1) % 5;
        let value = self.fm.iter().sum::<f32>() / 5.;
        let lane = (clock % 5) as usize;
        let mut f = self.lanes[lane].push(value, clock, nid)?;
        if f.duid == Duid::Tsdu {
            let mut soft = [(0, 0.); 98];
            for i in 0..98 {
                soft[i] = (f.data[i], f.soft[i]);
            }
            let (b, c) = trellis::trellis_decode(&soft, &LEVELS);
            if trellis::tsbk_crc_ok(&b) {
                f.score = -1_000_000. + c as f32;
                if b[0] & 0x80 != 0 {
                    self.lanes[lane].active = false;
                }
            }
        }
        Some(f)
    }
}
fn channel_taps(n: usize, cutoff: f64, rate: f64) -> Vec<f64> {
    let fc = cutoff / rate;
    let mut taps: Vec<_> = (0..n)
        .map(|i| {
            let x = i as f64 - (n - 1) as f64 / 2.;
            let h = if x == 0. {
                2. * fc
            } else {
                (2. * PI * fc * x).sin() / (PI * x)
            };
            h * (0.54 - 0.46 * (2. * PI * i as f64 / (n - 1) as f64).cos())
        })
        .collect();
    let sum: f64 = taps.iter().sum();
    for t in &mut taps {
        *t /= sum;
    }
    taps
}
/// A three-stage CIC rejects wideband aliases before a windowed FIR at 96 kHz.
struct ChannelDsp {
    hz: u32,
    re: f64,
    im: f64,
    step_re: f64,
    step_im: f64,
    integrators: [[i64; 2]; 3],
    combs: [[i64; 2]; 3],
    cic_n: usize,
    taps: Vec<f64>,
    history: Vec<[f64; 2]>,
    pos: usize,
    decim: usize,
    symbols: SymbolDecoder,
    clock: u64,
    pending: Vec<Frame>,
    last_end: Option<u64>,
    voice: VoicePipeline,
    tg: u16,
    source: u32,
    clear: bool,
    crypto_known: bool,
    ended: bool,
    last_grant: u64,
}
impl ChannelDsp {
    fn new(hz: u32, center: u32, rate: u32) -> Self {
        let angle = -2. * PI * (hz as f64 - center as f64) / rate as f64;
        let n = 81;
        let taps = channel_taps(n, 6250., 96000.);
        Self {
            hz,
            re: 1.,
            im: 0.,
            step_re: angle.cos(),
            step_im: angle.sin(),
            integrators: [[0; 2]; 3],
            combs: [[0; 2]; 3],
            cic_n: 0,
            taps,
            history: vec![[0.; 2]; n],
            pos: 0,
            decim: 0,
            symbols: SymbolDecoder::new(),
            clock: 0,
            pending: vec![],
            last_end: None,
            voice: VoicePipeline::new(true),
            tg: 0,
            source: 0,
            clear: false,
            crypto_known: false,
            ended: false,
            last_grant: 0,
        }
    }
    fn process(&mut self, iq: &[u8], rate: u32, nid: &NidDecoder) -> Vec<Frame> {
        let cic_rate = (rate / 96000) as usize;
        let scale = (cic_rate as f64).powi(3) * 32768.;
        for s in iq.chunks_exact(2) {
            let i = (s[0] as f64 - 127.5) / 128.;
            let q = (s[1] as f64 - 127.5) / 128.;
            let mut x = [
                ((i * self.re - q * self.im) * 32768.) as i64,
                ((i * self.im + q * self.re) * 32768.) as i64,
            ];
            let nr = self.re * self.step_re - self.im * self.step_im;
            self.im = self.re * self.step_im + self.im * self.step_re;
            self.re = nr;
            for stage in &mut self.integrators {
                for j in 0..2 {
                    stage[j] = stage[j].wrapping_add(x[j]);
                    x[j] = stage[j];
                }
            }
            self.cic_n += 1;
            if self.cic_n < cic_rate {
                continue;
            }
            self.cic_n = 0;
            for stage in &mut self.combs {
                for j in 0..2 {
                    let prev = stage[j];
                    stage[j] = x[j];
                    x[j] = x[j].wrapping_sub(prev);
                }
            }
            self.history[self.pos] = [x[0] as f64 / scale, x[1] as f64 / scale];
            self.pos = (self.pos + 1) % self.taps.len();
            self.decim += 1;
            if self.decim < 4 {
                continue;
            }
            self.decim = 0;
            let mut z = [0.; 2];
            for (j, tap) in self.taps.iter().enumerate() {
                let p = (self.pos + self.taps.len() - 1 - j) % self.taps.len();
                z[0] += self.history[p][0] * tap;
                z[1] += self.history[p][1] * tap;
            }
            let frame = self.symbols.push(z, self.clock, nid);
            if let Some(f) = frame {
                if let Some(old) = self
                    .pending
                    .iter_mut()
                    .find(|p| p.duid == f.duid && p.end.abs_diff(f.end) < 15)
                {
                    if f.score < old.score {
                        *old = f;
                    }
                } else {
                    self.pending.push(f);
                }
            }
            self.clock += 1;
        }
        let norm = (self.re * self.re + self.im * self.im).sqrt();
        if norm > 0. {
            self.re /= norm;
            self.im /= norm;
        }
        let mut ready = vec![];
        let mut later = vec![];
        for f in self.pending.drain(..) {
            if self.clock.saturating_sub(f.end) < 15 {
                later.push(f);
                continue;
            }
            if self.last_end.is_none_or(|t| f.end.abs_diff(t) > 15) {
                self.last_end = Some(f.end);
                ready.push(f);
            }
        }
        self.pending = later;
        ready
    }
}

struct Patch {
    group: u16,
    members: Vec<u16>,
    expires: u64,
}
#[wasm_bindgen]
pub struct Receiver {
    rate: u32,
    center: u32,
    control_hz: u32,
    control: ChannelDsp,
    voices: Vec<ChannelDsp>,
    nid: NidDecoder,
    plan: IdenTable,
    information: information::SystemState,
    activity: activity::Activity,
    ranks: Vec<usize>,
    patches: Vec<Patch>,
    events: Vec<Event>,
    pcm: Vec<f32>,
    audio_tg: u16,
    samples: u64,
    valid: u32,
    invalid: u32,
    frames: u32,
    voice_frames: u32,
    held: Option<u16>,
    patch_membership: bool,
}
#[wasm_bindgen]
impl Receiver {
    #[wasm_bindgen(constructor)]
    pub fn new(center: u32, control: u32, rate: u32) -> Result<Receiver, JsValue> {
        if rate != 2400000 {
            return Err(JsValue::from_str(
                "This C4FM pipeline requires a 2.4 MS/s input.",
            ));
        }
        let control_dsp = ChannelDsp::new(control, center, rate);
        Ok(Receiver {
            rate,
            center,
            control_hz: control,
            control: control_dsp,
            voices: vec![],
            nid: NidDecoder::new(),
            plan: IdenTable::new(),
            information: information::SystemState::default(),
            activity: activity::Activity::default(),
            ranks: vec![usize::MAX; 65536],
            patches: vec![],
            events: vec![],
            pcm: vec![],
            audio_tg: 0,
            samples: 0,
            valid: 0,
            invalid: 0,
            frames: 0,
            voice_frames: 0,
            held: None,
            patch_membership: true,
        })
    }
    pub fn set_listen(&mut self, groups: Vec<u16>, hold: u16) {
        self.patch_membership = true;
        self.ranks.fill(usize::MAX);
        for (index, group) in groups.into_iter().enumerate() {
            self.ranks[group as usize] = self.ranks[group as usize].min(index);
        }
        self.held = if hold == 0 { None } else { Some(hold) };
        self.voices.clear();
        self.pcm.clear();
    }
    /// O(1) per-grant membership, equal priority for all enabled groups. A fresh
    /// all-talkgroups policy must not preempt calls just because an ID is lower.
    pub fn set_enabled(&mut self, enabled: &[u8]) -> bool {
        if enabled.len() != 65536 {
            return false;
        }
        for (i, value) in enabled.iter().enumerate() {
            self.ranks[i] = if i > 0 && *value != 0 {
                100
            } else {
                usize::MAX
            };
        }
        self.held = None;
        self.patch_membership = false;
        self.voices.clear();
        self.pcm.clear();
        self.audio_tg = 0;
        true
    }
    pub fn process(&mut self, iq: &[u8]) {
        self.samples += iq.len() as u64 / 2;
        self.activity
            .prune(self.samples, self.rate, &self.plan, &self.voices);
        self.patches.retain(|p| p.expires > self.samples);
        let frames = self.control.process(iq, self.rate, &self.nid);
        for f in frames {
            self.handle_control(f);
        }
        let mut decoded = vec![];
        for (i, v) in self.voices.iter_mut().enumerate() {
            for f in v.process(iq, self.rate, &self.nid) {
                decoded.push((i, f));
            }
        }
        for (i, f) in decoded {
            self.handle_voice(i, f);
        }
        self.voices.retain(|v| {
            !v.ended && self.samples.saturating_sub(v.last_grant) < self.rate as u64 * 4
        });
    }
    pub fn take_events(&mut self) -> String {
        serde_json::to_string(&std::mem::take(&mut self.events)).unwrap_or("[]".into())
    }
    pub fn take_audio(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.pcm)
    }
    pub fn audio_talkgroup(&self) -> u16 {
        self.audio_tg
    }
    pub fn stats(&self) -> String {
        serde_json::json!({"valid":self.valid,"invalid":self.invalid,"frames":self.frames,"voiceFrames":self.voice_frames,"channels":self.voices.len(),"seconds":self.samples as f64/self.rate as f64}).to_string()
    }
    /// A current summary; frequencies are re-resolved after later band plans.
    pub fn information(&self) -> String {
        self.information.snapshot(self).to_string()
    }
    pub fn activity(&self) -> String {
        self.activity.snapshot(self).to_string()
    }
    /// Reset only RF-dependent DSP after a hardware center-frequency change.
    /// Learned plans, site/assignment state, counters and RF sample time survive.
    pub fn recenter(&mut self, center: u32) -> bool {
        if !(24000000..=1766000000).contains(&center)
            || center.abs_diff(self.control_hz) > self.rate / 2 - 24000
        {
            return false;
        }
        if center == self.center {
            return true;
        }
        self.center = center;
        self.control = ChannelDsp::new(self.control_hz, center, self.rate);
        let old = std::mem::take(&mut self.voices);
        for voice in old {
            if !voice.ended
                && (!voice.crypto_known || voice.clear)
                && self.listening(voice.tg)
                && voice.hz.abs_diff(center) < self.rate / 2 - 24000
            {
                let mut next = ChannelDsp::new(voice.hz, center, self.rate);
                next.tg = voice.tg;
                next.source = voice.source;
                next.clear = voice.clear;
                next.crypto_known = voice.crypto_known;
                next.last_grant = voice.last_grant;
                self.voices.push(next);
            }
        }
        self.pcm.clear();
        self.audio_tg = 0;
        true
    }
}

/// Deterministic CU8 C4FM fixture, not real radio traffic or intelligible speech.
/// It exercises CRC-valid band/site/grants and the actual IMBE decoder.
#[wasm_bindgen]
pub struct ArmerTestSource {
    control: Vec<Vec<u8>>,
    voice: Vec<Vec<u8>>,
    re: [f64; 2],
    im: [f64; 2],
    samples: usize,
}
fn fixture_block(op: u8, args: [u8; 8]) -> [u8; 12] {
    let mut b = [0; 12];
    b[0] = op;
    b[2..10].copy_from_slice(&args);
    trellis::tsbk_seal(&mut b);
    b
}
#[wasm_bindgen]
impl ArmerTestSource {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let sync: Vec<u8> = (0..24).map(|i| ((FS >> (46 - i * 2)) & 3) as u8).collect();
        let iden = fixture_block(
            0x3d,
            ((100u64 << 51) | (180u64 << 42) | (50u64 << 32) | 170201250).to_be_bytes(),
        );
        let site = fixture_block(0xba, [0, 0x14, 0x0f, 5, 75, 0x01, 0x4b, 0]);
        let network = fixture_block(0x3b, [0, 0xbe, 0xe0, 0x74, 0x0f, 0x01, 0x4b, 0]);
        // MFID 0x90 / opcode 0x0B: eight six-bit characters, ASCII minus 43,
        // independently packed as TEST123 + NULL, followed by channel 0x014B.
        let mut station = fixture_block(0x0b, [0xa5, 0xaa, 0x29, 0x18, 0x72, 0, 0x01, 0x4b]);
        station[1] = 0x90;
        trellis::tsbk_seal(&mut station);
        let iden1 = fixture_block(
            0xbd,
            ((1u64 << 60) | (100u64 << 51) | (376u64 << 42) | (50u64 << 32) | 152401250)
                .to_be_bytes(),
        );
        let secondary = fixture_block(0x39, [5, 75, 0x01, 0xcb, 0x70, 0x01, 0xcb, 0]);
        let neighbor = fixture_block(0xbc, [0, 0x34, 0x0f, 1, 6, 0, 233, 0x70]);
        let mut control = vec![];
        let mut voice = vec![];
        for (tg, channel, encrypted) in [
            (6620u16, 279u16, false),
            (6640, 279, false),
            (6670, 279, true),
            (43216, 1000, false),
        ] {
            let grant = fixture_block(
                0x00,
                [
                    if encrypted { 0x44 } else { 4 },
                    (channel >> 8) as u8,
                    channel as u8,
                    (tg >> 8) as u8,
                    tg as u8,
                    0,
                    0,
                    42,
                ],
            );
            let blocks = [
                iden, grant, site, network, station, iden1, secondary, neighbor,
            ];
            let encoded: Vec<_> = blocks
                .iter()
                .map(|b| trellis::interleave(&trellis::trellis_encode(b)))
                .collect();
            // P25 TSDU supports up to three blocks per frame; emit broadcasts in a
            // second frame so all grants retain valid framing/status symbols.
            let mut c = frame::tsdu_frame_dibits(&sync, 0x40c, &encoded[..3]);
            c.extend(frame::tsdu_frame_dibits(&sync, 0x40c, &encoded[3..6]));
            c.extend(frame::tsdu_frame_dibits(&sync, 0x40c, &encoded[6..]));
            control.push(c);
            let mut body = sync.clone();
            body.extend(frame::nid_dibits(frame::nid_encode(0x40c, Duid::Ldu1)));
            body.extend(fec::ldu_body_encode(
                &[[0; 8]; 9],
                &[
                    0,
                    0,
                    if encrypted { 0x40 } else { 0 },
                    0,
                    (tg >> 8) as u8,
                    tg as u8,
                    0,
                    0,
                    42,
                ],
                true,
                0,
            ));
            voice.push(frame::insert_status(&body, 1));
        }
        Self {
            control,
            voice,
            re: [1.0; 2],
            im: [0.0; 2],
            samples: 0,
        }
    }
    pub fn process(&mut self, center: u32, count: usize) -> Vec<u8> {
        let count = count.min(262144);
        let mut iq = Vec::with_capacity(count * 2);
        let levels = [600.0, 1800.0, -600.0, -1800.0];
        let steps: Vec<Vec<(f64, f64)>> = [853075000.0, 852750000.0]
            .iter()
            .map(|hz| {
                levels
                    .iter()
                    .map(|l| {
                        let p = 2.0 * PI * (hz - center as f64 + l) / 2400000.0;
                        (p.cos(), p.sin())
                    })
                    .collect()
            })
            .collect();
        // Rotate fixture groups only between whole control cycles, so a clean
        // source cannot change a grant halfway through its encoded CRC block.
        let cycle_samples = self.control[0].len() * 500;
        let phase_samples = (4800000 / cycle_samples).max(1) * cycle_samples;
        for _ in 0..count {
            let phase = (self.samples / phase_samples) % 4;
            let symbol = self.samples / 500;
            let dibits = [
                self.control[phase][symbol % self.control[phase].len()],
                self.voice[phase][symbol % self.voice[phase].len()],
            ];
            for c in 0..2 {
                let (wr, wi) = steps[c][dibits[c] as usize];
                let re = self.re[c] * wr - self.im[c] * wi;
                self.im[c] = self.re[c] * wi + self.im[c] * wr;
                self.re[c] = re;
            }
            iq.push((127.5 + 35.0 * self.re[0] + 35.0 * self.re[1]).round() as u8);
            iq.push((127.5 + 35.0 * self.im[0] + 35.0 * self.im[1]).round() as u8);
            self.samples += 1;
            if self.samples % 4096 == 0 {
                for c in 0..2 {
                    let n = self.re[c].hypot(self.im[c]);
                    self.re[c] /= n;
                    self.im[c] /= n;
                }
            }
        }
        iq
    }
}
impl Receiver {
    fn listening(&self, tg: u16) -> bool {
        let has = |t| {
            self.held
                .map_or(self.ranks[t as usize] != usize::MAX, |h| h == t)
        };
        has(tg)
            || self.patch_membership
                && self
                    .patches
                    .iter()
                    .any(|p| p.group == tg && p.members.iter().any(|t| has(*t)))
    }
    fn rank(&self, tg: u16) -> usize {
        if !self.patch_membership {
            return self.ranks[tg as usize];
        }
        self.patches
            .iter()
            .filter(|p| p.group == tg)
            .flat_map(|p| p.members.iter())
            .map(|t| self.ranks[*t as usize])
            .fold(self.ranks[tg as usize], usize::min)
    }
    fn emit(&mut self, mut e: Event) {
        e.time = self.samples as f64 / self.rate as f64;
        if e.members.is_empty() && matches!(e.kind.as_str(), "grant" | "voice") {
            if let Some(p) = self.patches.iter().find(|p| p.group == e.talkgroup) {
                e.members = p.members.clone();
            }
        }
        self.events.push(e);
    }
    fn handle_control(&mut self, f: Frame) {
        self.frames += 1;
        if f.duid != Duid::Tsdu {
            return;
        }
        let mut soft = [(0u8, 0f32); 98];
        for i in 0..98 {
            soft[i] = (f.data[i], f.soft[i]);
        }
        let (block, correction) = trellis::trellis_decode(&soft, &LEVELS);
        if !trellis::tsbk_crc_ok(&block) {
            self.invalid += 1;
            return;
        }
        self.valid += 1;
        let t = Tsbk::from_block(&block, true);
        if t.protected {
            return;
        }
        self.information.observe(&t, f.nac);
        if block[1] == 0x90 {
            let a = t.args;
            match t.opcode {
                0 | 1 => {
                    let group = u16::from_be_bytes([a[0], a[1]]);
                    let members: Vec<u16> = a[2..]
                        .chunks_exact(2)
                        .map(|p| u16::from_be_bytes([p[0], p[1]]))
                        .filter(|&m| m != 0 && m != group)
                        .collect();
                    if t.opcode == 0 {
                        if let Some(p) = self.patches.iter_mut().find(|p| p.group == group) {
                            for &m in &members {
                                if !p.members.contains(&m) {
                                    p.members.push(m);
                                }
                            }
                            p.expires = self.samples + self.rate as u64 * 20;
                        } else {
                            self.patches.push(Patch {
                                group,
                                members: members.clone(),
                                expires: self.samples + self.rate as u64 * 20,
                            });
                        }
                    } else if let Some(p) = self.patches.iter_mut().find(|p| p.group == group) {
                        p.members.retain(|m| !members.contains(m));
                    }
                    let mut e = event("patch", self.control_hz);
                    e.talkgroup = group;
                    e.members = members;
                    e.message = if t.opcode == 0 {
                        "Patch added"
                    } else {
                        "Patch members removed"
                    }
                    .into();
                    self.emit(e);
                }
                2 => {
                    self.grant(
                        u16::from_be_bytes([a[1], a[2]]),
                        u16::from_be_bytes([a[3], a[4]]),
                        u32::from_be_bytes([0, a[5], a[6], a[7]]),
                        Some(a[0] & 0x40 != 0),
                    );
                }
                3 => {
                    for p in a.chunks_exact(4) {
                        self.grant(
                            u16::from_be_bytes([p[0], p[1]]),
                            u16::from_be_bytes([p[2], p[3]]),
                            0,
                            None,
                        );
                    }
                }
                _ => {}
            }
        }
        match t.parse() {
            TsbkKind::GroupVoiceGrant {
                svc,
                chan,
                group,
                src,
            } => self.grant(chan, group, src, Some(svc & 0x40 != 0)),
            TsbkKind::GroupGrantUpdate {
                chan1,
                group1,
                chan2,
                group2,
            } => {
                self.grant(chan1, group1, 0, None);
                self.grant(chan2, group2, 0, None);
            }
            TsbkKind::IdenUp(slot) | TsbkKind::IdenUpVu(slot) | TsbkKind::IdenUpTdma(slot) => {
                self.plan.learn(slot);
                let mut e = event("bandplan", self.control_hz);
                e.message = format!(
                    "Band {}: {:.6} MHz + {} Hz × channel · {} slot(s)",
                    slot.iden,
                    slot.base_hz as f64 / 1e6,
                    slot.spacing_hz,
                    slot.slots
                );
                self.emit(e);
            }
            TsbkKind::NetStatus { wacn, sysid, .. } => {
                let mut e = event("network", self.control_hz);
                e.wacn = wacn;
                e.system = sysid;
                e.nac = f.nac;
                self.emit(e);
            }
            TsbkKind::RfssStatus {
                sysid, rfss, site, ..
            } => {
                let mut e = event("site", self.control_hz);
                e.system = sysid;
                e.rfss = rfss;
                e.site = site;
                e.nac = f.nac;
                self.emit(e);
            }
            TsbkKind::GroupAffResp { group, target, .. }
            | TsbkKind::LocRegResp { group, src: target } => {
                let mut e = event("affiliation", self.control_hz);
                e.talkgroup = group;
                e.source = target;
                e.message = "Radio affiliation".into();
                self.emit(e);
            }
            _ => {}
        }
        let mut e = event("control", self.control_hz);
        e.nac = f.nac;
        e.corrections = correction + f.correction as u32;
        e.message = t.hex();
        let station = match t.parse() {
            TsbkKind::Motorola(p25::motorola::TsbkKind::BsiGrant { callsign, chan }) => {
                Some(StationIdentification {
                    callsign: callsign.text(),
                    valid: callsign.is_valid(),
                    channel: chan,
                    frequency: self.plan.resolve(chan).map_or(0, |c| c.rx_hz as u32),
                })
            }
            _ => None,
        };
        e.control = Some(ControlInformation {
            opcode: t.opcode,
            mfid: block[1],
            text: frame::describe(&t, &self.plan),
            station,
        });
        self.emit(e);
    }
    fn grant(&mut self, channel: u16, tg: u16, source: u32, encrypted: Option<bool>) {
        if tg == 0 {
            return;
        }
        self.activity
            .grant(channel, tg, source, encrypted, self.samples);
        let resolved = self.plan.resolve(channel);
        let hz = resolved.map_or(0, |c| c.rx_hz as u32);
        let mut e = event("grant", hz);
        e.channel = channel;
        e.talkgroup = tg;
        e.source = source;
        e.encrypted = encrypted;
        if hz == 0 {
            e.message = "Waiting for broadcast band plan".into();
            self.emit(e);
            return;
        }
        let inside = hz.abs_diff(self.center) < self.rate / 2 - 24000;
        if !inside {
            e.message = "Outside receiver bandwidth".into();
        }
        self.emit(e);
        if encrypted == Some(true) {
            self.voices.retain(|v| v.hz != hz);
            return;
        }
        if !inside || !self.listening(tg) {
            return;
        }
        if let Some(v) = self.voices.iter_mut().find(|v| v.hz == hz) {
            if v.tg != tg {
                v.voice.reset();
                v.tg = tg;
                v.source = 0;
                v.clear = false;
                v.crypto_known = false;
            }
            if source != 0 {
                v.source = source;
            }
            if let Some(enc) = encrypted {
                v.clear = !enc;
                v.crypto_known = true;
            }
            v.last_grant = self.samples;
            return;
        }
        // One selected voice stream prevents unrelated talkers being interleaved in audio.
        if let Some(v) = self.voices.first() {
            if self.rank(tg) < self.rank(v.tg) {
                self.voices.clear();
            } else {
                return;
            }
        }
        let mut v = ChannelDsp::new(hz, self.center, self.rate);
        v.tg = tg;
        v.source = source;
        v.clear = encrypted == Some(false);
        v.crypto_known = encrypted.is_some();
        v.last_grant = self.samples;
        self.voices.push(v);
    }
    fn handle_voice(&mut self, index: usize, f: Frame) {
        let v = &mut self.voices[index];
        if f.duid == Duid::Tdu {
            self.activity.finish(v.hz, v.tg, &self.plan);
            v.ended = true;
            v.clear = false;
            v.voice.reset();
            return;
        }
        if f.duid == Duid::Hdu {
            if let Some((bytes, _)) = fec::hdu_decode(&f.data) {
                let h = frame::HeaderData::from_bytes(&bytes);
                if h.tgid != v.tg {
                    v.clear = false;
                    v.crypto_known = false;
                } else {
                    v.clear = h.ess.is_clear();
                    v.crypto_known = true;
                }
                self.activity.voice(
                    v.hz,
                    v.tg,
                    v.source,
                    if v.crypto_known { Some(!v.clear) } else { None },
                    self.samples,
                    &self.plan,
                );
            }
            return;
        }
        if !matches!(f.duid, Duid::Ldu1 | Duid::Ldu2) {
            return;
        }
        let d = fec::ldu_body_decode(&f.data, f.duid == Duid::Ldu1, None);
        if d.extra_rs_ok {
            if f.duid == Duid::Ldu2 {
                let ess = frame::EncryptionSync::from_bytes(&d.extra);
                v.clear = ess.is_clear();
                v.crypto_known = true;
            } else if let LcKind::GroupVoiceUser { svc, tg, src } =
                frame::LinkControl::from_bytes(d.extra[..9].try_into().unwrap()).parse()
            {
                if tg != v.tg {
                    v.clear = false;
                    v.crypto_known = false;
                } else {
                    v.source = src;
                    if svc & 0x40 != 0 {
                        v.clear = false;
                        v.crypto_known = true;
                    }
                }
            }
        }
        v.last_grant = self.samples;
        let tg = v.tg;
        let hz = v.hz;
        let source = v.source;
        let clear = v.clear;
        let known = v.crypto_known;
        self.activity.voice(
            hz,
            tg,
            source,
            if known { Some(!clear) } else { None },
            self.samples,
            &self.plan,
        );
        if clear {
            for slot in &d.voice {
                let action = v.voice.decide(slot.as_ref());
                let pcm = v.voice.render(action, slot.as_ref());
                self.pcm.extend(pcm.iter().map(|s| *s as f32 / 32768.));
                self.voice_frames += 1;
            }
            self.audio_tg = tg;
        }
        let mut e = event("voice", hz);
        e.talkgroup = tg;
        e.source = source;
        e.encrypted = if known { Some(!clear) } else { None };
        e.corrections = d.corrections;
        e.message = if clear {
            "IMBE audio decoded"
        } else {
            "Audio withheld: encryption state not confirmed clear"
        }
        .into();
        self.emit(e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sync() -> Vec<u8> {
        (0..24).map(|i| ((FS >> (46 - i * 2)) & 3) as u8).collect()
    }
    fn block(op: u8, args: [u8; 8]) -> [u8; 12] {
        let mut b = [0u8; 12];
        b[0] = op;
        b[2..10].copy_from_slice(&args);
        trellis::tsbk_seal(&mut b);
        b
    }
    fn frame_for(blocks: &[[u8; 12]]) -> Vec<u8> {
        let enc: Vec<_> = blocks
            .iter()
            .map(|b| trellis::interleave(&trellis::trellis_encode(b)))
            .collect();
        frame::tsdu_frame_dibits(&sync(), 0x40c, &enc)
    }
    fn feed_dibits(r: &mut Receiver, dibits: &[u8]) {
        let mut lane = Lane::new();
        for (i, &d) in dibits.iter().enumerate() {
            let value = [600., 1800., -600., -1800.][d as usize];
            if let Some(f) = lane.push(value, i as u64 * 5, &r.nid) {
                r.handle_control(f);
            }
        }
    }
    #[test]
    fn valid_crc_decodes_site_identity() {
        let b = block(0x3a, [0, 0x04, 0x0f, 5, 75, 0x01, 0x4b, 0]);
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        feed_dibits(&mut r, &frame_for(&[b, b, b]));
        assert!(
            r.events
                .iter()
                .any(|e| e.kind == "site" && e.rfss == 5 && e.site == 75 && e.system == 0x40f)
        );
    }
    #[test]
    fn corrupted_crc_is_never_trusted() {
        let mut b = block(0x3a, [0, 0x04, 0x0f, 5, 75, 0x01, 0x4b, 0]);
        b[4] ^= 1;
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        feed_dibits(&mut r, &frame_for(&[b, b, b]));
        assert_eq!(r.valid, 0);
        assert_eq!(r.invalid, 3);
        assert!(!r.events.iter().any(|e| e.kind == "site"));
    }
    fn station_block(field: [u8; 6]) -> [u8; 12] {
        let mut b = block(0x8b, [0, 0, 0, 0, 0, 0, 0x01, 0x4b]);
        b[1] = 0x90;
        b[2..8].copy_from_slice(&field);
        trellis::tsbk_seal(&mut b);
        b
    }
    #[test]
    fn station_identification_requires_a_clear_crc_valid_motorola_block() {
        // Independent wire vector: TEST123 + NULL, 6-bit characters (ASCII - 43).
        let b = station_block([0xa5, 0xaa, 0x29, 0x18, 0x72, 0]);
        let mut r = with_plan();
        feed_dibits(&mut r, &frame_for(&[b]));
        let control = r.events.iter().find_map(|e| e.control.as_ref()).unwrap();
        let station = control.station.as_ref().unwrap();
        assert_eq!(station.callsign, "TEST123");
        assert!(station.valid);
        assert_eq!(station.channel, 0x014b);
        assert_eq!(station.frequency, 853075000);
        assert!(control.text.contains("TEST123"));
        assert!(
            r.voices.is_empty(),
            "A station ID must never trigger voice following"
        );

        let mut bad_crc = b;
        bad_crc[4] ^= 1;
        let mut other_vendor = b;
        other_vendor[1] = 0xa4;
        trellis::tsbk_seal(&mut other_vendor);
        let mut protected = b;
        protected[0] |= 0x40;
        trellis::tsbk_seal(&mut protected);
        for bytes in [bad_crc, other_vendor, protected] {
            let mut r = with_plan();
            feed_dibits(&mut r, &frame_for(&[bytes]));
            assert!(!r.events.iter().any(|e| {
                e.control
                    .as_ref()
                    .and_then(|c| c.station.as_ref())
                    .is_some()
            }));
            let summary: serde_json::Value = serde_json::from_str(&r.information()).unwrap();
            assert!(summary["station"].is_null());
        }
    }
    #[test]
    fn system_summary_resolves_announcements_after_their_band_plan_arrives() {
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        let network = block(0xbb, [0, 0xbe, 0xe0, 0x74, 0x0f, 0x01, 0x4b, 0]);
        let site = block(0xba, [0, 0x14, 0x0f, 5, 75, 0x01, 0x4b, 0]);
        let neighbor = block(0xbc, [0, 0x34, 0x0f, 1, 6, 0, 233, 0x70]);
        let secondary = block(0xb9, [5, 75, 0x01, 0xcb, 0x70, 0x01, 0xcb, 0]);
        for b in [network, site, neighbor, secondary] {
            feed_dibits(&mut r, &frame_for(&[b]));
        }
        let before: serde_json::Value = serde_json::from_str(&r.information()).unwrap();
        assert!(before["primary"]["downlink"].is_null());
        assert_eq!(before["network"]["lra"], 0);
        assert_eq!(before["site"]["flags"], 1);
        assert_eq!(before["neighbors"][0]["flags"], 3);
        let iden = block(
            0xbd,
            ((100u64 << 51) | (180u64 << 42) | (50u64 << 32) | 170201250).to_be_bytes(),
        );
        feed_dibits(&mut r, &frame_for(&[iden]));
        let after: serde_json::Value = serde_json::from_str(&r.information()).unwrap();
        assert_eq!(after["network"]["wacn"], 0xbee07);
        assert_eq!(after["site"]["site"], 75);
        assert_eq!(
            after["primary"],
            serde_json::json!({"id":331,"downlink":853075000,"uplink":808075000})
        );
        assert_eq!(
            after["secondary"][0],
            serde_json::json!({"id":459,"downlink":853875000,"uplink":808875000})
        );
        assert_eq!(
            after["secondary"].as_array().unwrap().len(),
            1,
            "Absent second SCC entry must not be invented"
        );
        assert_eq!(
            after["neighbors"][0]["control"],
            serde_json::json!({"id":233,"downlink":852462500,"uplink":807462500})
        );
        // Updating the same neighboring site replaces its row, not its identity.
        let neighbor = block(0xbc, [3, 0x14, 0x0f, 1, 6, 0, 231, 0x70]);
        feed_dibits(&mut r, &frame_for(&[neighbor]));
        let after: serde_json::Value = serde_json::from_str(&r.information()).unwrap();
        assert_eq!(after["neighbors"].as_array().unwrap().len(), 1);
        assert_eq!(after["neighbors"][0]["lra"], 3);
        assert_eq!(after["neighbors"][0]["control"]["downlink"], 852450000);
    }
    #[test]
    fn summary_explicit_uplink_and_active_patches_are_not_guessed() {
        let mut r = with_plan();
        let site = block(0xba, [0, 0x14, 0x0f, 5, 75, 0x01, 0x4b, 0]);
        let explicit = block(0xa9, [5, 75, 0x01, 0xcb, 0, 0xff, 0xff, 0x70]);
        for b in [site, explicit] {
            feed_dibits(&mut r, &frame_for(&[b]));
        }
        r.patches.push(Patch {
            group: 65000,
            members: vec![6620, 6640],
            expires: r.samples + r.rate as u64 * 20,
        });
        let snapshot: serde_json::Value = serde_json::from_str(&r.information()).unwrap();
        assert_eq!(snapshot["secondary"][0]["downlink"], 853875000);
        assert!(
            snapshot["secondary"][0]["uplink"].is_null(),
            "Explicit no-uplink sentinel cannot fall back to the implicit offset"
        );
        assert_eq!(
            snapshot["patches"][0]["members"],
            serde_json::json!([6620, 6640])
        );
        r.samples += r.rate as u64 * 21;
        let expired: serde_json::Value = serde_json::from_str(&r.information()).unwrap();
        assert!(expired["patches"].as_array().unwrap().is_empty());
    }
    #[test]
    fn station_identification_keeps_empty_and_invalid_characters_distinct() {
        for (field, valid) in [([0; 6], true), ([0xff, 0, 0, 0, 0, 0], false)] {
            let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
            feed_dibits(&mut r, &frame_for(&[station_block(field)]));
            let station = r
                .events
                .iter()
                .find_map(|e| e.control.as_ref()?.station.as_ref())
                .unwrap();
            assert_eq!(station.valid, valid);
            if valid {
                assert!(station.callsign.is_empty());
            }
            assert_eq!(
                station.frequency, 0,
                "No invented frequency without a band plan"
            );
            assert_eq!(station.channel, 0x014b);
        }
    }
    #[test]
    fn muted_and_encrypted_calls_never_allocate_voice() {
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        r.plan.learn(frame::IdenSlot {
            iden: 0,
            base_hz: 851006250,
            spacing_hz: 6250,
            tx_offset_hz: -45000000,
            bw_hz: 12500,
            slots: 1,
        });
        r.set_listen(vec![6620], 0);
        r.grant(331, 43216, 1, Some(false));
        assert!(r.voices.is_empty());
        r.grant(331, 6620, 1, Some(true));
        assert!(r.voices.is_empty());
        r.grant(331, 6620, 1, Some(false));
        assert_eq!(r.voices.len(), 1);
    }
    #[test]
    fn patch_membership_and_hold_apply() {
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        r.set_listen(vec![6642], 0);
        r.patches.push(Patch {
            group: 6640,
            members: vec![6642],
            expires: 100,
        });
        assert!(r.listening(6640));
        r.set_listen(vec![6642], 6620);
        assert!(!r.listening(6640));
        assert!(r.listening(6620));
    }
    #[test]
    fn full_range_policy_keeps_priority_exclusions_and_can_be_replaced() {
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        let groups = std::iter::once(6620)
            .chain((1..=65535).filter(|t| *t != 6620 && *t != 6646))
            .collect();
        r.set_listen(groups, 0);
        assert!(r.listening(1));
        assert!(r.listening(65535));
        assert!(!r.listening(6646));
        assert_eq!(r.rank(6620), 0);
        assert!(r.rank(1) > r.rank(6620));
        r.set_listen(vec![6642], 0);
        assert!(!r.listening(65535));
        assert_eq!(r.rank(65535), usize::MAX);
        assert!(r.listening(6642));
    }
    #[test]
    fn all_groups_default_has_explicit_mutes_and_equal_priority() {
        let mut r = with_plan();
        let mut enabled = vec![1; 65536];
        enabled[0] = 0;
        enabled[6640] = 0;
        assert!(r.set_enabled(&enabled));
        assert!(r.listening(65535));
        assert!(!r.listening(6640));
        r.patches.push(Patch {
            group: 6640,
            members: vec![6620],
            expires: u64::MAX,
        });
        assert!(
            !r.listening(6640),
            "An enabled patch member must not override an explicit group mute"
        );
        assert_eq!(r.rank(1), r.rank(65535));
        r.grant(279, 6620, 1, Some(false));
        r.grant(331, 1, 2, Some(false));
        assert_eq!(
            r.voices[0].tg, 6620,
            "equal-priority calls must not preempt by numeric ID"
        );
        enabled.fill(0);
        r.set_enabled(&enabled);
        assert!(r.voices.is_empty());
    }
    fn with_plan() -> Receiver {
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        r.plan.learn(frame::IdenSlot {
            iden: 0,
            base_hz: 851006250,
            spacing_hz: 6250,
            tx_offset_hz: -45000000,
            bw_hz: 12500,
            slots: 1,
        });
        r.set_listen(vec![6620, 6640], 0);
        r
    }
    #[test]
    fn activity_tracks_all_assignments_and_replaces_reused_channel_metadata() {
        let mut r = with_plan();
        r.grant(279, 6620, 42, Some(false));
        r.grant(331, 6640, 0, None);
        let calls: serde_json::Value = serde_json::from_str(&r.activity()).unwrap();
        assert_eq!(calls.as_array().unwrap().len(), 2);
        assert_eq!(calls[0]["selected"], true);
        assert_eq!(calls[1]["selected"], false);
        r.grant(279, 6640, 0, None);
        let calls: serde_json::Value = serde_json::from_str(&r.activity()).unwrap();
        assert_eq!(calls[0]["talkgroup"], 6640);
        assert_eq!(
            calls[0]["source"], 0,
            "Reassignment cannot inherit the previous talker's ID"
        );
        assert!(calls[0]["encrypted"].is_null());
        r.grant(1000, 43216, 12, Some(false));
        r.grant(0x1001, 60001, 0, None);
        let calls: serde_json::Value = serde_json::from_str(&r.activity()).unwrap();
        assert_eq!(calls.as_array().unwrap().len(), 4);
        assert_eq!(calls[2]["inCapture"], false);
        assert_eq!(calls[3]["frequency"], 0);
        assert!(calls[3]["encrypted"].is_null());
    }
    #[test]
    fn voice_activity_survives_policy_changes_and_expires_without_new_evidence() {
        let mut r = with_plan();
        r.grant(279, 6620, 42, Some(false));
        r.samples = r.rate as u64 * 3;
        r.activity
            .voice(852750000, 6620, 999, Some(true), r.samples, &r.plan);
        r.set_enabled(&vec![0; 65536]);
        r.samples = r.rate as u64 * 5;
        r.process(&[]);
        let calls: serde_json::Value = serde_json::from_str(&r.activity()).unwrap();
        assert_eq!(calls[0]["source"], 999);
        assert_eq!(calls[0]["encrypted"], true);
        assert_eq!(calls[0]["selected"], false);
        assert_eq!(calls[0]["age"], 2.0);
        r.samples = r.rate as u64 * 7;
        r.process(&[]);
        assert_eq!(r.activity(), "[]");
    }
    #[test]
    fn a_decoded_terminator_removes_the_active_call_immediately() {
        let mut r = with_plan();
        r.grant(279, 6620, 42, Some(false));
        r.handle_voice(
            0,
            Frame {
                duid: Duid::Tdu,
                nac: 0x40c,
                correction: 0,
                data: vec![],
                soft: vec![],
                end: 0,
                score: 0.,
            },
        );
        assert_eq!(r.activity(), "[]");
        assert!(r.voices[0].ended);
    }
    #[test]
    fn priority_preempts_a_lower_ranked_call() {
        let mut r = with_plan();
        r.grant(279, 6640, 1, Some(false));
        assert_eq!(r.voices[0].tg, 6640);
        r.grant(145, 6620, 2, Some(false));
        assert_eq!(r.voices[0].tg, 6620);
    }
    #[test]
    fn center_only_retune_keeps_control_knowledge_assignments_and_rf_clock() {
        let mut r = with_plan();
        feed_dibits(
            &mut r,
            &frame_for(&[block(0xba, [0, 0x14, 0x0f, 5, 75, 0x01, 0x4b, 0])]),
        );
        r.grant(279, 6620, 42, Some(false));
        r.samples = r.rate as u64 * 2;
        let stats = r.stats();
        let information = r.information();
        r.pcm.extend([0.1, 0.2]);
        r.audio_tg = 6620;
        assert!(r.recenter(853850000));
        assert_eq!(r.center, 853850000);
        assert_eq!(r.control_hz, 853075000);
        assert_eq!(r.stats(), stats);
        assert_eq!(r.information(), information);
        assert_eq!(r.voices[0].source, 42);
        assert_eq!(r.voices[0].tg, 6620);
        assert!(r.pcm.is_empty());
        assert_eq!(r.audio_tg, 0);
        let calls: serde_json::Value = serde_json::from_str(&r.activity()).unwrap();
        assert_eq!(calls[0]["age"], 2.0, "Retuning must not refresh old grants");
        assert!(!r.recenter(857000000));
        assert_eq!(r.center, 853850000);
        assert_eq!(r.information(), information);
    }
    #[test]
    fn clear_ldu_reaches_the_imbe_vocoder_and_unknown_crypto_does_not() {
        let mut r = with_plan();
        r.grant(279, 6620, 42, Some(false));
        let extra = [0, 0, 0, 0, 0x19, 0xdc, 0, 0, 42];
        let body = fec::ldu_body_encode(&[[0; 8]; 9], &extra, true, 0);
        r.handle_voice(
            0,
            Frame {
                duid: Duid::Ldu1,
                nac: 0x40c,
                correction: 0,
                data: body.clone(),
                soft: vec![],
                end: 0,
                score: 0.,
            },
        );
        assert_eq!(r.pcm.len(), 1440);
        assert!(r.pcm.iter().all(|s| s.is_finite()));
        assert!(r.pcm.iter().any(|s| s.abs() > 0.));
        r.pcm.clear();
        r.voices[0].clear = false;
        r.voices[0].crypto_known = false;
        r.handle_voice(
            0,
            Frame {
                duid: Duid::Ldu1,
                nac: 0x40c,
                correction: 0,
                data: body,
                soft: vec![],
                end: 0,
                score: 0.,
            },
        );
        assert!(r.pcm.is_empty());
        assert_eq!(r.events.last().unwrap().encrypted, None);
    }
    #[test]
    fn complete_iq_pipeline_recovers_crc_valid_trunking_across_usb_chunks() {
        let b = block(0x3a, [0, 0x04, 0x0f, 5, 75, 0x01, 0x4b, 0]);
        let dibits = frame_for(&[b, b, b]);
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        let mut phase = 0f64;
        let mut iq = Vec::new();
        for _ in 0..8 {
            for &d in &dibits {
                let hz = 675000. + [600., 1800., -600., -1800.][d as usize];
                let step = 2. * PI * hz / 2400000.;
                for _ in 0..500 {
                    phase = (phase + step) % (2. * PI);
                    iq.push((127.5 + 60. * phase.cos()) as u8);
                    iq.push((127.5 + 60. * phase.sin()) as u8);
                }
            }
        }
        for chunk in iq.chunks(131072) {
            r.process(chunk);
        }
        assert!(
            r.valid >= 20,
            "only {} valid / {} invalid",
            r.valid,
            r.invalid
        );
        assert!(
            r.events
                .iter()
                .any(|e| e.kind == "site" && e.site == 75 && e.system == 0x40f)
        );
    }
    #[test]
    fn simultaneous_control_and_voice_carriers_decode_from_iq_to_pcm() {
        let iden_args = ((100u64 << 51) | (180u64 << 42) | (50u64 << 32) | 170201250).to_be_bytes();
        let iden = block(0x3d, iden_args);
        let grant = block(0x00, [4, 1, 23, 0x19, 0xdc, 0, 0, 42]);
        let site = block(0xba, [0, 0x04, 0x0f, 5, 75, 0x01, 0x4b, 0]);
        let control = frame_for(&[iden, grant, site]);
        let mut voice_data = sync();
        voice_data.extend(frame::nid_dibits(frame::nid_encode(0x40c, Duid::Ldu1)));
        voice_data.extend(fec::ldu_body_encode(
            &[[0; 8]; 9],
            &[0, 0, 0, 0, 0x19, 0xdc, 0, 0, 42],
            true,
            0,
        ));
        let voice = frame::insert_status(&voice_data, 1);
        let mut r = Receiver::new(852400000, 853075000, 2400000).unwrap();
        r.set_listen(vec![6620], 0);
        let mut cp = 0f64;
        let mut vp = 0f64;
        let levels = [600., 1800., -600., -1800.];
        let mut iq = Vec::new();
        for n in 0..2400000 {
            let c = control[(n / 500) % control.len()] as usize;
            let v = voice[(n / 500) % voice.len()] as usize;
            cp = (cp + 2. * PI * (675000. + levels[c]) / 2400000.) % (2. * PI);
            vp = (vp + 2. * PI * (350000. + levels[v]) / 2400000.) % (2. * PI);
            iq.push((127.5 + 35. * cp.cos() + 35. * vp.cos()) as u8);
            iq.push((127.5 + 35. * cp.sin() + 35. * vp.sin()) as u8);
        }
        for chunk in iq.chunks(131072) {
            r.process(chunk);
        }
        assert!(r.valid > 10, "control blocks: {}", r.valid);
        assert!(r.pcm.len() >= 1440, "no voice from IQ; stats {}", r.stats());
        assert!(r.pcm.iter().any(|s| s.abs() > 0.));
        assert!(r.pcm.iter().all(|s| s.is_finite()));
        assert!(
            r.events
                .iter()
                .any(|e| e.kind == "voice" && e.talkgroup == 6620 && e.encrypted == Some(false))
        );
    }
}
