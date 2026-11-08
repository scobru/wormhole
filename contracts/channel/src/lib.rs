//! Wormhole Channel contract on Freenet: decentralized rendezvous & file manifest channel.
//!
//! Parameters: 32-byte BLAKE3 hash of the mnemonic rendezvous code.
//! State: JSON-encoded ChannelState containing encrypted file manifest.
//!
//! Merge laws:
//! - manifest: once set, stays (or updates if newer timestamp)
//! - offer: set by sender
//! - answer: set by receiver
//! - candidates: set-union of ICE candidates (BTreeSet)
//! - idempotent, associative, commutative join-semilattice.

use freenet_stdlib::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const MAX_STATE_SIZE: usize = 128 * 1024; // 128 KB max for manifest + signaling

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ChannelState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub candidates: BTreeSet<String>,
    #[serde(default)]
    pub updated_at: u64,
}

impl ChannelState {
    pub fn merge_with(&mut self, inc: ChannelState) {
        if self.manifest.is_none() || (inc.manifest.is_some() && inc.updated_at >= self.updated_at) {
            if let Some(m) = inc.manifest {
                self.manifest = Some(m);
            }
        }
        if self.offer.is_none() {
            if let Some(o) = inc.offer {
                self.offer = Some(o);
            }
        }
        if self.answer.is_none() {
            if let Some(a) = inc.answer {
                self.answer = Some(a);
            }
        }
        for c in inc.candidates {
            self.candidates.insert(c);
        }
        if inc.updated_at > self.updated_at {
            self.updated_at = inc.updated_at;
        }
    }
}

fn digest16(bytes: &[u8]) -> [u8; 16] {
    let mut out = [0u8; 16];
    out.copy_from_slice(&blake3::hash(bytes).as_bytes()[..16]);
    out
}

pub struct WormholeChannelContract;

#[contract]
impl ContractInterface for WormholeChannelContract {
    fn validate_state(
        parameters: Parameters<'static>,
        state: State<'static>,
        _related: RelatedContracts<'static>,
    ) -> Result<ValidateResult, ContractError> {
        let p = parameters.as_ref();
        let s = state.as_ref();
        if p.len() != 32 {
            return Ok(ValidateResult::Invalid);
        }
        if s.is_empty() || s.len() > MAX_STATE_SIZE {
            return Ok(ValidateResult::Invalid);
        }
        if serde_json::from_slice::<ChannelState>(s).is_err() {
            return Ok(ValidateResult::Invalid);
        }
        Ok(ValidateResult::Valid)
    }

    fn update_state(
        parameters: Parameters<'static>,
        state: State<'static>,
        data: Vec<UpdateData<'static>>,
    ) -> Result<UpdateModification<'static>, ContractError> {
        let p = parameters.as_ref();
        if p.len() != 32 {
            return Err(ContractError::InvalidUpdate);
        }

        let mut current: ChannelState = if state.as_ref().is_empty() {
            ChannelState::default()
        } else {
            serde_json::from_slice(state.as_ref()).map_err(|_| ContractError::InvalidUpdate)?
        };

        for item in data {
            let bytes = match item {
                UpdateData::State(s) => s.as_ref().to_vec(),
                UpdateData::Delta(d) => d.as_ref().to_vec(),
                UpdateData::StateAndDelta { delta, .. } => delta.as_ref().to_vec(),
                _ => continue,
            };
            if bytes.is_empty() || bytes.len() > MAX_STATE_SIZE {
                continue;
            }
            if let Ok(incoming) = serde_json::from_slice::<ChannelState>(&bytes) {
                current.merge_with(incoming);
            }
        }

        let new_bytes = serde_json::to_vec(&current).map_err(|_| ContractError::InvalidUpdate)?;
        if new_bytes.len() > MAX_STATE_SIZE {
            return Err(ContractError::InvalidUpdate);
        }
        Ok(UpdateModification::valid(State::from(new_bytes)))
    }

    fn summarize_state(
        _parameters: Parameters<'static>,
        state: State<'static>,
    ) -> Result<StateSummary<'static>, ContractError> {
        let d = digest16(state.as_ref());
        Ok(StateSummary::from(d.to_vec()))
    }

    fn get_state_delta(
        _parameters: Parameters<'static>,
        state: State<'static>,
        summary: StateSummary<'static>,
    ) -> Result<StateDelta<'static>, ContractError> {
        let s = state.as_ref();
        let current_digest = digest16(s);
        if summary.as_ref() == current_digest.as_slice() {
            // Already converged: return empty delta as required by Freenet
            Ok(StateDelta::from(vec![]))
        } else {
            Ok(StateDelta::from(s.to_vec()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semilattice_merge() {
        let mut s1 = ChannelState {
            manifest: Some("enc_manifest_1".into()),
            offer: Some("sdp_offer".into()),
            answer: None,
            candidates: BTreeSet::from(["cand1".into()]),
            updated_at: 100,
        };

        let s2 = ChannelState {
            manifest: None,
            offer: None,
            answer: Some("sdp_answer".into()),
            candidates: BTreeSet::from(["cand2".into()]),
            updated_at: 105,
        };

        s1.merge_with(s2.clone());

        assert_eq!(s1.manifest.as_deref(), Some("enc_manifest_1"));
        assert_eq!(s1.offer.as_deref(), Some("sdp_offer"));
        assert_eq!(s1.answer.as_deref(), Some("sdp_answer"));
        assert_eq!(s1.candidates.len(), 2);
        assert_eq!(s1.updated_at, 105);

        // Idempotency: merging same again doesn't change anything
        let copy = s1.clone();
        s1.merge_with(s2);
        assert_eq!(s1, copy);
    }

    #[test]
    fn test_delta_empty_when_summary_matches() {
        let s = serde_json::to_vec(&ChannelState {
            manifest: Some("test".into()),
            ..Default::default()
        })
        .unwrap();

        let sum = WormholeChannelContract::summarize_state(
            Parameters::from(vec![0u8; 32]),
            State::from(s.clone()),
        )
        .unwrap();

        let delta = WormholeChannelContract::get_state_delta(
            Parameters::from(vec![0u8; 32]),
            State::from(s),
            sum,
        )
        .unwrap();

        assert!(delta.as_ref().is_empty());
    }
}

