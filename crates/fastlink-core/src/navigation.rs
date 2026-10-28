/**
 * Feature Reconstruction: FastLink Navigation Decision & Route Policy Engine
 * Reverse-Engineered from: vercel-labs/fast-link (packages/core/src/navigation/index.ts & packages/next/src/navigation-policy/index.ts)
 * Evidence Digest: sha256:e70b2eca58620ecb7a7c7798bc30a2d5b4bd6f9d4dc5deb29d6ec02c88db70d7
 * Invariants: ADR 0003 (Applications choose router or document navigation)
 */

use serde::{Deserialize, Serialize};
use crate::interaction::FastLinkIntent;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentMethod {
    Assign,
    Replace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FastNavigationDecision {
    Router {
        #[serde(skip_serializing_if = "Option::is_none")]
        scroll: Option<bool>,
    },
    Document {
        method: DocumentMethod,
    },
}

impl Default for FastNavigationDecision {
    fn default() -> Self {
        Self::Router { scroll: None }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FastRouterProposal {
    pub destination: String,
    pub method: String,
    pub scroll: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutePolicyRule {
    pub pattern: String,
    pub decision: FastNavigationDecision,
    pub priority: i32,
    pub is_prefix: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RoutePolicyEngine {
    rules: Vec<RoutePolicyRule>,
    default_decision: FastNavigationDecision,
}

impl RoutePolicyEngine {
    pub fn new(default_decision: FastNavigationDecision) -> Self {
        Self {
            rules: Vec::new(),
            default_decision,
        }
    }

    pub fn add_rule(&mut self, rule: RoutePolicyRule) {
        self.rules.push(rule);
        self.rules.sort_by(|a, b| b.priority.cmp(&a.priority));
    }

    pub fn resolve(&self, intent: &FastLinkIntent) -> FastNavigationDecision {
        let path = &intent.pathname;
        for rule in &self.rules {
            if rule.is_prefix {
                if path.starts_with(&rule.pattern) {
                    return rule.decision.clone();
                }
            } else if path == &rule.pattern {
                return rule.decision.clone();
            }
        }
        self.default_decision.clone()
    }
}
