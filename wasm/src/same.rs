//! Optional, modulation-independent SAME receiver. Only demodulated mono audio
//! enters this module. Modem/timing/three-burst recovery: sameold (MIT).
use sameold::{LinkState, Message, SameEventType, SameReceiver, SameReceiverBuilder};
use serde::Serialize;
use std::collections::VecDeque;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Event {
    Burst {
        raw: String,
        bytes: Vec<u8>,
        seconds: f64,
    },
    Message {
        raw: String,
        voted: usize,
        errors: usize,
        seconds: f64,
    },
    Rejected {
        reason: String,
        seconds: f64,
    },
    Tone {
        tone: &'static str,
        edge: &'static str,
        start: f64,
        end: Option<f64>,
        seconds: f64,
    },
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostics {
    samples: u64,
    bursts: u64,
    messages: u64,
    recovered: u64,
    rejected: u64,
    sync_losses: u64,
    dropped: u64,
    timed_out: u64,
    link: String,
    afsk: &'static str,
    last_success: Option<f64>,
}

// 40 ms Goertzel windows; high spectral purity and two seconds of persistence
// reject speech/music/noise. These are tone observations, never alert evidence.
struct Tones {
    size: u32,
    count: u32,
    coeff: [f64; 5],
    a: [f64; 5],
    b: [f64; 5],
    power: f64,
    dc: f64,
    candidate: Option<&'static str>,
    start: f64,
    last_good: f64,
    active: bool,
    enabled: bool,
}
impl Tones {
    fn new(rate: u32) -> Self {
        Self {
            size: rate / 25,
            count: 0,
            coeff: [1050., 853., 960., 2083.333333, 1562.5]
                .map(|f| 2. * (std::f64::consts::TAU * f / rate as f64).cos()),
            a: [0.; 5],
            b: [0.; 5],
            power: 0.,
            dc: 0.,
            candidate: None,
            start: 0.,
            last_good: 0.,
            active: false,
            enabled: true,
        }
    }
    fn push(
        &mut self,
        sample: f32,
        seconds: f64,
        out: &mut VecDeque<Event>,
        diag: &mut Diagnostics,
    ) {
        self.dc += 0.002 * (sample as f64 - self.dc);
        let x = sample as f64 - self.dc;
        self.power += x * x;
        for k in if self.enabled { 0 } else { 3 }..5 {
            let z = x + self.coeff[k] * self.a[k] - self.b[k];
            self.b[k] = self.a[k];
            self.a[k] = z;
        }
        self.count += 1;
        if self.count != self.size {
            return;
        }
        let energy = self.power.max(1e-18);
        let p = std::array::from_fn::<_, 5, _>(|k| {
            2. * (self.a[k] * self.a[k] + self.b[k] * self.b[k]
                - self.coeff[k] * self.a[k] * self.b[k])
                .max(0.)
                / (self.size as f64 * energy)
        });
        diag.afsk = if energy / (self.size as f64) < 1e-8 {
            "quiet"
        } else if p[3] > 0.65 {
            "mark"
        } else if p[4] > 0.65 {
            "space"
        } else if p[3] + p[4] > 0.5 {
            "AFSK energy"
        } else {
            "other audio"
        };
        let found = if !self.enabled || energy / (self.size as f64) < 1e-7 {
            None
        } else if p[0] > 0.90 {
            Some("noaa1050")
        } else if p[1] > 0.25 && p[2] > 0.25 && p[1] + p[2] > 0.90 {
            Some("easDual")
        } else {
            None
        };
        self.count = 0;
        self.a = [0.; 5];
        self.b = [0.; 5];
        self.power = 0.;
        if found != self.candidate {
            if self.candidate.is_some() && seconds - self.last_good < 0.12 && found.is_none() {
                return;
            }
            if self.active {
                out.push_back(Event::Tone {
                    tone: self.candidate.unwrap(),
                    edge: "end",
                    start: self.start,
                    end: Some(self.last_good),
                    seconds,
                });
            }
            self.candidate = found;
            self.start = seconds - 0.04;
            self.active = false;
        }
        if let Some(tone) = found {
            self.last_good = seconds;
            if !self.active && seconds - self.start >= 2.0 - 1e-6 {
                self.active = true;
                out.push_back(Event::Tone {
                    tone,
                    edge: "start",
                    start: self.start,
                    end: None,
                    seconds,
                });
            }
        }
    }
}

#[wasm_bindgen]
pub struct SameDecoder {
    receiver: SameReceiver,
    rate: u32,
    diagnostics: Diagnostics,
    tones: Tones,
    events: VecDeque<Event>,
    receiver_base: u64,
    reading_since: Option<u64>,
    last_eom_estimate: Option<u64>,
}
#[wasm_bindgen]
impl SameDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(rate: u32) -> Result<Self, JsValue> {
        if !(8000..=96000).contains(&rate) {
            return Err(JsValue::from_str("SAME needs mono audio at 8–96 kHz."));
        }
        let mut receiver = SameReceiverBuilder::new(rate)
            .with_agc_bandwidth(0.05)
            .with_agc_gain_limits(0.001, 1000.0)
            .build();
        // Normalized float audio needs unity initial gain; the crate builder
        // starts at its minimum (suited to unnormalized integer sound input).
        receiver.reset();
        Ok(Self {
            receiver,
            rate,
            diagnostics: Diagnostics {
                link: "no carrier".into(),
                afsk: "quiet",
                ..Diagnostics::default()
            },
            tones: Tones::new(rate),
            events: VecDeque::new(),
            receiver_base: 0,
            reading_since: None,
            last_eom_estimate: None,
        })
    }
    pub fn set_attention_enabled(&mut self, enabled: bool) {
        if self.tones.enabled != enabled {
            self.tones = Tones::new(self.rate);
            self.tones.enabled = enabled;
        }
    }
    pub fn process_audio(&mut self, samples: &[f32]) {
        let diag = &mut self.diagnostics;
        let queue = &mut self.events;
        // Bound even a malformed, endless stream of allowed ASCII bytes.
        // The upstream framer otherwise grows until carrier loss. Reset only
        // after six seconds of continuous frame data (a max-size header <4 s).
        for chunk in samples.chunks(2048) {
            for event in self.receiver.iter_events(
                chunk
                    .iter()
                    .copied()
                    .map(|s| if s.is_finite() { s } else { 0. }),
            ) {
                let at = self.receiver_base + event.input_sample_counter();
                let seconds = at as f64 / self.rate as f64;
                if let SameEventType::Link(link) = event.what() {
                    diag.link = link.as_ref().into();
                    self.reading_since = if matches!(link, LinkState::Reading) {
                        self.reading_since.or(Some(at))
                    } else {
                        None
                    };
                    if matches!(link, LinkState::NoCarrier) {
                        diag.sync_losses += 1;
                    }
                }
                if let Some(bytes) = event.burst() {
                    if bytes.len() >= 4
                        && bytes[..4]
                            .iter()
                            .zip(b"NNNN")
                            .map(|(a, b)| ((a & 0x7f) ^ b).count_ones())
                            .sum::<u32>()
                            <= 2
                    {
                        self.last_eom_estimate = Some(at);
                    }
                    diag.bursts += 1;
                    queue.push_back(Event::Burst {
                        raw: bytes.iter().map(|b| char::from(b & 0x7f)).collect(),
                        bytes: bytes.to_vec(),
                        seconds,
                    });
                }
                if let Some(message) = event.message() {
                    match message {
                        Ok(msg) => {
                            // sameold forces EOM after its voice-message timeout.
                            // That is not an observed wire marker. Only publish an
                            // EOM with recent preamble/framer evidence, including
                            // damaged NNNN estimates recovered by the combiner.
                            if matches!(msg, Message::EndOfMessage)
                                && !self.last_eom_estimate.is_some_and(|seen| {
                                    at.saturating_sub(seen) <= self.rate as u64 * 10
                                })
                            {
                                diag.timed_out += 1;
                                continue;
                            }
                            diag.messages += 1;
                            diag.last_success = Some(seconds);
                            let voted = msg.voting_byte_count();
                            let errors = msg.parity_error_count();
                            if voted != 0 || errors != 0 {
                                diag.recovered += 1;
                            }
                            queue.push_back(Event::Message {
                                raw: msg.as_str().into(),
                                voted,
                                errors,
                                seconds,
                            });
                        }
                        Err(err) => {
                            diag.rejected += 1;
                            queue.push_back(Event::Rejected {
                                reason: err.to_string(),
                                seconds,
                            });
                        }
                    }
                }
                while queue.len() > 64 {
                    queue.pop_front();
                    diag.dropped += 1;
                }
            }
            let at = self.receiver_base + self.receiver.input_sample_counter();
            if self
                .reading_since
                .is_some_and(|start| at - start > self.rate as u64 * 6)
            {
                self.receiver.reset();
                self.receiver_base = at;
                self.reading_since = None;
                diag.rejected += 1;
                diag.sync_losses += 1;
                diag.link = "no carrier".into();
                queue.push_back(Event::Rejected {
                    reason: "SAME frame exceeded six seconds; decoder resynchronized.".into(),
                    seconds: at as f64 / self.rate as f64,
                });
            }
        }
        for &sample in samples {
            diag.samples += 1;
            self.tones.push(
                if sample.is_finite() { sample } else { 0. },
                diag.samples as f64 / self.rate as f64,
                queue,
                diag,
            );
        }
        while queue.len() > 64 {
            queue.pop_front();
            diag.dropped += 1;
        }
    }
    pub fn has_events(&self) -> bool {
        !self.events.is_empty()
    }
    pub fn take_events(&mut self) -> String {
        let result = serde_json::to_string(&self.events).unwrap();
        self.events.clear();
        result
    }
    pub fn status(&self) -> String {
        serde_json::to_string(&self.diagnostics).unwrap()
    }
    /// Drain modem tail using bounded silence, without truncating a last burst.
    pub fn finish(&mut self) {
        let silence = [0.; 1024];
        let mut remaining = self.rate as usize * 6;
        while remaining > 0 {
            let n = remaining.min(silence.len());
            self.process_audio(&silence[..n]);
            remaining -= n;
        }
    }
}
