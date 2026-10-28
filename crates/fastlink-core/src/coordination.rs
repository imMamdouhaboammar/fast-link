/**
 * Feature Reconstruction: FastLink Coordination & Click Suppression
 * Reverse-Engineered from: vercel-labs/fast-link (packages/core/src/coordination/index.ts & controller/index.ts)
 * Evidence Digest: sha256:e70b2eca58620ecb7a7c7798bc30a2d5b4bd6f9d4dc5deb29d6ec02c88db70d7
 * Invariants: ADR 0005 (Coordinate anchor controllers and containing regions)
 */

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FollowupClickEvent {
    pub target_id: String,
    pub anchor_id: String,
    pub detail: u32,
    pub default_prevented: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClickAction {
    Suppress,
    PassThroughNative,
    AlreadySuppressed,
}

#[derive(Debug, Default)]
pub struct CoordinationState {
    anchor_owners: HashMap<String, usize>,
    pending_clicks: HashMap<String, String>,
    suppressed_event_ids: HashSet<String>,
    handled_pointerdown_ids: HashSet<String>,
}

impl CoordinationState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_anchor(&mut self, anchor_id: &str) {
        let count = self.anchor_owners.entry(anchor_id.to_string()).or_insert(0);
        *count += 1;
    }

    pub fn unregister_anchor(&mut self, anchor_id: &str) {
        if let Some(count) = self.anchor_owners.get_mut(anchor_id) {
            if *count <= 1 {
                self.anchor_owners.remove(anchor_id);
            } else {
                *count -= 1;
            }
        }
        self.pending_clicks.remove(anchor_id);
    }

    pub fn has_anchor_owner(&self, anchor_id: &str) -> bool {
        self.anchor_owners.contains_key(anchor_id)
    }

    pub fn mark_pointerdown_handled(&mut self, event_id: &str, anchor_id: &str, controller_id: &str) {
        self.handled_pointerdown_ids.insert(event_id.to_string());
        self.pending_clicks.insert(anchor_id.to_string(), controller_id.to_string());
    }

    pub fn is_pointerdown_handled(&self, event_id: &str) -> bool {
        self.handled_pointerdown_ids.contains(event_id)
    }

    pub fn consume_click(
        &mut self,
        event_id: &str,
        anchor_id: &str,
        detail: u32,
    ) -> ClickAction {
        if detail == 0 {
            return ClickAction::PassThroughNative;
        }

        if self.suppressed_event_ids.contains(event_id) {
            return ClickAction::AlreadySuppressed;
        }

        if self.pending_clicks.remove(anchor_id).is_some() {
            self.suppressed_event_ids.insert(event_id.to_string());
            ClickAction::Suppress
        } else {
            ClickAction::PassThroughNative
        }
    }

    pub fn clear_pending(&mut self, anchor_id: &str) {
        self.pending_clicks.remove(anchor_id);
    }
}
