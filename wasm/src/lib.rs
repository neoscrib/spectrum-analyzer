//! Independently built decoder modules. Each release build enables one feature.
//! Shared source primitives are dead-stripped; the high-rate channelizer is a
//! separate runtime module used by WFM, AM, WWV, OOK and rtl_433.
#[allow(dead_code)]
mod dsp;
#[cfg(feature = "same")]
mod same;
#[cfg(feature = "same")]
pub use same::SameDecoder;
#[allow(unused_imports)]
use dsp::{AUDIO_RATE, Downconverter, Fir, IF_RATE, INPUT_RATE, lowpass};
#[cfg(feature = "core")]
mod channelizer;
#[cfg(feature = "core")]
pub use channelizer::{Channelizer, IqChannelizer};
#[cfg(feature = "wfm")]
mod rds;
#[cfg(feature = "wfm")]
mod wfm;
#[cfg(feature = "wfm")]
pub use wfm::WfmDecoder;
#[cfg(any(feature = "am", feature = "wwv"))]
mod am;
#[cfg(feature = "am")]
pub use am::AmDecoder;
#[cfg(feature = "wwv")]
mod wwv;
#[cfg(feature = "wwv")]
pub use wwv::WwvDecoder;
#[cfg(feature = "ook")]
mod ook;
#[cfg(feature = "ook")]
pub use ook::OokDecoder;
#[cfg(feature = "nfm")]
mod nfm;
#[cfg(feature = "nfm")]
mod squelch;
#[cfg(feature = "nfm")]
pub use nfm::NfmDecoder;
#[cfg(feature = "armer")]
mod armer;
#[cfg(feature = "armer")]
pub use armer::Receiver;
