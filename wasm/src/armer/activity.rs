//! Recent live voice assignments, independent of the one audible receiver.
use super::{ChannelDsp, Receiver};
use p25::frame::IdenTable;
use serde_json::{Value, json};
use std::collections::BTreeMap;

struct Assignment {
    talkgroup: u16,
    source: u32,
    encrypted: Option<bool>,
    last_seen: u64,
}
#[derive(Default)]
pub(super) struct Activity {
    calls: BTreeMap<u16, Assignment>,
}
fn selected<'a>(
    channel: u16,
    call: &Assignment,
    plan: &IdenTable,
    voices: &'a [ChannelDsp],
) -> Option<&'a ChannelDsp> {
    let frequency = plan.resolve(channel)?.rx_hz;
    voices
        .iter()
        .find(|v| !v.ended && v.tg == call.talkgroup && v.hz as u64 == frequency)
}
impl Activity {
    pub fn grant(
        &mut self,
        channel: u16,
        talkgroup: u16,
        source: u32,
        encrypted: Option<bool>,
        samples: u64,
    ) {
        if let Some(call) = self.calls.get_mut(&channel) {
            if call.talkgroup == talkgroup {
                if source != 0 {
                    call.source = source;
                }
                if encrypted.is_some() {
                    call.encrypted = encrypted;
                }
                call.last_seen = samples;
                return;
            }
        }
        if self.calls.len() >= 128 && !self.calls.contains_key(&channel) {
            if let Some(oldest) = self
                .calls
                .iter()
                .min_by_key(|(_, call)| call.last_seen)
                .map(|(&id, _)| id)
            {
                self.calls.remove(&oldest);
            }
        }
        // A new talkgroup on this channel replaces the old assignment and its
        // source/encryption metadata, even when this call cannot be followed.
        self.calls.insert(
            channel,
            Assignment {
                talkgroup,
                source,
                encrypted,
                last_seen: samples,
            },
        );
    }
    pub fn prune(&mut self, samples: u64, rate: u32, plan: &IdenTable, voices: &[ChannelDsp]) {
        self.calls.retain(|&channel, call| {
            let seen = selected(channel, call, plan, voices)
                .map_or(call.last_seen, |v| v.last_grant.max(call.last_seen));
            samples.saturating_sub(seen) < rate as u64 * 4
        });
    }
    pub fn finish(&mut self, frequency: u32, talkgroup: u16, plan: &IdenTable) {
        self.calls.retain(|&channel, call| {
            call.talkgroup != talkgroup
                || plan
                    .resolve(channel)
                    .is_none_or(|c| c.rx_hz != frequency as u64)
        });
    }
    pub fn voice(
        &mut self,
        frequency: u32,
        talkgroup: u16,
        source: u32,
        encrypted: Option<bool>,
        samples: u64,
        plan: &IdenTable,
    ) {
        for (&channel, call) in &mut self.calls {
            if call.talkgroup == talkgroup
                && plan
                    .resolve(channel)
                    .is_some_and(|c| c.rx_hz == frequency as u64)
            {
                if source != 0 {
                    call.source = source;
                }
                call.encrypted = encrypted;
                call.last_seen = samples;
            }
        }
    }
    pub fn snapshot(&self, receiver: &Receiver) -> Value {
        let calls: Vec<_> = self.calls.iter().map(|(&channel, call)| {
            let frequency = receiver.plan.resolve(channel).map_or(0, |c| c.rx_hz as u32);
            let voice = selected(channel, call, &receiver.plan, &receiver.voices);
            let seen = voice.map_or(call.last_seen, |v| v.last_grant.max(call.last_seen));
            let encrypted = voice.map(|v| if v.crypto_known { Some(!v.clear) } else { None }).unwrap_or(call.encrypted);
            json!({
                "channel": channel, "talkgroup": call.talkgroup,
                "source": voice.map_or(call.source, |v| v.source),
                "frequency": frequency, "encrypted": encrypted,
                "selected": voice.is_some(),
                "inCapture": frequency != 0 && frequency.abs_diff(receiver.center) < receiver.rate / 2 - 24000,
                "phase2": receiver.plan.timeslot(channel).is_some_and(|(_, tdma)| tdma),
                "age": receiver.samples.saturating_sub(seen) as f64 / receiver.rate as f64
            })
        }).collect();
        json!(calls)
    }
}
