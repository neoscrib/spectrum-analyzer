//! State assembled from CRC-checked, unprotected control-channel broadcasts.
use super::{Receiver, StationIdentification};
use p25::frame::{Tsbk, TsbkKind};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Clone, Serialize)]
struct Network {
    wacn: u32,
    system: u16,
    nac: u16,
    lra: u8,
    channel: u16,
}
#[derive(Clone, Serialize)]
struct Site {
    system: u16,
    nac: u16,
    rfss: u8,
    site: u8,
    lra: u8,
    flags: u8,
    channel: u16,
}
struct Secondary {
    rfss: u8,
    site: u8,
    channel: u16,
    explicit: bool,
    receive: Option<u16>,
}
#[derive(Default)]
pub(super) struct SystemState {
    network: Option<Network>,
    site: Option<Site>,
    neighbors: BTreeMap<(u16, u8, u8), Site>,
    secondary: BTreeMap<(u8, u8, u16), Secondary>,
    station: Option<StationIdentification>,
}
impl SystemState {
    pub fn observe(&mut self, t: &Tsbk, nac: u16) {
        if !t.crc_ok || t.protected {
            return;
        }
        match t.parse() {
            TsbkKind::NetStatus {
                wacn, sysid, chan, ..
            } => {
                self.network = Some(Network {
                    wacn,
                    system: sysid,
                    nac,
                    lra: t.args[0],
                    channel: chan,
                });
            }
            TsbkKind::RfssStatus {
                sysid,
                rfss,
                site,
                chan,
                ..
            } => {
                self.site = Some(Site {
                    system: sysid,
                    nac,
                    rfss,
                    site,
                    lra: t.args[0],
                    flags: (t.args[1] >> 4) & 1,
                    channel: chan,
                });
            }
            TsbkKind::AdjStatus {
                sysid,
                rfss,
                site,
                chan,
                ..
            } => {
                let key = (sysid, rfss, site);
                if self.neighbors.contains_key(&key) || self.neighbors.len() < 256 {
                    self.neighbors.insert(
                        key,
                        Site {
                            system: sysid,
                            nac,
                            rfss,
                            site,
                            lra: t.args[0],
                            flags: t.args[1] >> 4,
                            channel: chan,
                        },
                    );
                }
            }
            TsbkKind::SccBcst {
                rfss,
                site,
                chan1,
                chan2,
            } => {
                self.secondary(rfss, site, chan1, false, None);
                // The second entry is absent when its service class is zero.
                if chan2 != chan1 && t.args[7] != 0 {
                    self.secondary(rfss, site, chan2, false, None);
                }
            }
            TsbkKind::SccbExp {
                rfss,
                site,
                chan_t,
                chan_r,
                ..
            } => {
                self.secondary(
                    rfss,
                    site,
                    chan_t,
                    true,
                    (chan_r != 0xffff).then_some(chan_r),
                );
            }
            TsbkKind::Motorola(p25::motorola::TsbkKind::BsiGrant { callsign, chan }) => {
                self.station = Some(StationIdentification {
                    callsign: callsign.text(),
                    valid: callsign.is_valid(),
                    channel: chan,
                    frequency: 0,
                });
            }
            _ => {}
        }
    }
    fn secondary(
        &mut self,
        rfss: u8,
        site: u8,
        channel: u16,
        explicit: bool,
        receive: Option<u16>,
    ) {
        let key = (rfss, site, channel);
        if channel != 0xffff && (self.secondary.contains_key(&key) || self.secondary.len() < 64) {
            self.secondary.insert(
                key,
                Secondary {
                    rfss,
                    site,
                    channel,
                    explicit,
                    receive,
                },
            );
        }
    }
    pub fn snapshot(&self, receiver: &Receiver) -> Value {
        let channel = |id: u16, explicit: bool, receive: Option<u16>| {
            let downlink = receiver.plan.resolve(id).map(|c| c.rx_hz);
            let uplink = if explicit {
                receive.and_then(|r| receiver.plan.resolve(r).map(|c| c.rx_hz))
            } else {
                receiver.plan.resolve(id).map(|c| c.tx_hz)
            };
            json!({ "id": id, "downlink": downlink, "uplink": uplink })
        };
        let site = |s: &Site| {
            let mut value = json!(s);
            value["control"] = channel(s.channel, false, None);
            value
        };
        let primary = self
            .site
            .as_ref()
            .map(|s| s.channel)
            .or_else(|| self.network.as_ref().map(|n| n.channel));
        let secondary: Vec<_> = self
            .secondary
            .values()
            .filter(|s| {
                self.site
                    .as_ref()
                    .is_some_and(|here| here.rfss == s.rfss && here.site == s.site)
            })
            .map(|s| channel(s.channel, s.explicit, s.receive))
            .collect();
        let bands: Vec<_> = receiver
            .plan
            .slots()
            .map(|b| {
                json!({
                    "id": b.iden, "base": b.base_hz, "bandwidth": b.bw_hz,
                    "spacing": b.spacing_hz, "offset": b.tx_offset_hz, "slots": b.slots
                })
            })
            .collect();
        let patches: Vec<_> = receiver
            .patches
            .iter()
            .filter(|p| !p.members.is_empty() && p.expires > receiver.samples)
            .map(|p| {
                json!({
                    "group": p.group, "members": p.members,
                    "expiresIn": (p.expires - receiver.samples) as f64 / receiver.rate as f64
                })
            })
            .collect();
        let station = self.station.as_ref().map(|s| {
            json!({
                "callsign": s.callsign, "valid": s.valid,
                "control": channel(s.channel, false, None)
            })
        });
        json!({
            "network": self.network, "site": self.site.as_ref().map(site),
            "primary": primary.map(|id| channel(id, false, None)), "secondary": secondary,
            "neighbors": self.neighbors.values().map(site).collect::<Vec<_>>(),
            "bands": bands, "patches": patches, "station": station
        })
    }
}
