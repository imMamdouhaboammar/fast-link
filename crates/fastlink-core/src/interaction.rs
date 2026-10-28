/**
 * Feature Reconstruction: FastLink Core Eligibility Engine
 * Reverse-Engineered from: vercel-labs/fast-link (packages/core/src/interaction/index.ts)
 * Evidence Digest: sha256:e70b2eca58620ecb7a7c7798bc30a2d5b4bd6f9d4dc5deb29d6ec02c88db70d7
 * Invariants: ADR 0002 (Primary mouse pointerdown), ADR 0005 (Coordination)
 */

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PointerType {
    Mouse,
    Touch,
    Pen,
    #[serde(untagged)]
    Other(String),
}

impl Default for PointerType {
    fn default() -> Self {
        Self::Mouse
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModifierKeys {
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub meta: bool,
    #[serde(default)]
    pub shift: bool,
}

impl ModifierKeys {
    pub fn has_any(&self) -> bool {
        self.alt || self.ctrl || self.meta || self.shift
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchorAttributes {
    pub href: Option<String>,
    pub target: Option<String>,
    #[serde(default)]
    pub download: bool,
    pub role: Option<String>,
    #[serde(default)]
    pub data_no_fast_link: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteractionContext {
    #[serde(default)]
    pub pointer_type: PointerType,
    #[serde(default)]
    pub button: u16,
    #[serde(default)]
    pub modifiers: ModifierKeys,
    #[serde(default)]
    pub default_prevented: bool,
    #[serde(default)]
    pub is_handled: bool,
    #[serde(default)]
    pub nested_control: bool,
    #[serde(default)]
    pub nested_button_role: bool,
    pub current_origin: String,
    pub base_uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FastLinkIntent {
    pub raw_href: String,
    pub resolved_url: String,
    pub pathname: String,
    pub search: String,
    pub hash: String,
    pub origin: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", content = "reason")]
pub enum IneligibilityReason {
    DefaultPrevented,
    NonPrimaryButton { button: u16 },
    NonMousePointer { pointer_type: PointerType },
    ModifierKeyPressed,
    AlreadyHandled,
    AnchorOptedOut,
    AnchorRoleNotLink { role: String },
    NestedControlTag,
    NestedButtonRole,
    TargetNotSelf { target: String },
    DownloadAttributePresent,
    EmptyOrFragmentHref,
    CrossOrigin { expected: String, actual: String },
    InvalidUrl { url: String, error: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "eligible")]
pub enum EligibilityResult {
    #[serde(rename = "true")]
    Eligible { intent: FastLinkIntent },
    #[serde(rename = "false")]
    Ineligible { reason: IneligibilityReason },
}

impl EligibilityResult {
    pub fn is_eligible(&self) -> bool {
        matches!(self, Self::Eligible { .. })
    }

    pub fn intent(&self) -> Option<&FastLinkIntent> {
        match self {
            Self::Eligible { intent } => Some(intent),
            Self::Ineligible { .. } => None,
        }
    }
}

pub fn resolve_fast_link(
    ctx: &InteractionContext,
    anchor: &AnchorAttributes,
) -> EligibilityResult {
    if ctx.default_prevented {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::DefaultPrevented,
        };
    }

    if ctx.button != 0 {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::NonPrimaryButton { button: ctx.button },
        };
    }

    if ctx.pointer_type != PointerType::Mouse {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::NonMousePointer {
                pointer_type: ctx.pointer_type.clone(),
            },
        };
    }

    if ctx.modifiers.has_any() {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::ModifierKeyPressed,
        };
    }

    if ctx.is_handled {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::AlreadyHandled,
        };
    }

    if anchor.data_no_fast_link {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::AnchorOptedOut,
        };
    }

    if let Some(role) = &anchor.role {
        let trimmed = role.trim();
        if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("link") {
            return EligibilityResult::Ineligible {
                reason: IneligibilityReason::AnchorRoleNotLink {
                    role: role.clone(),
                },
            };
        }
    }

    if ctx.nested_control {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::NestedControlTag,
        };
    }

    if ctx.nested_button_role {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::NestedButtonRole,
        };
    }

    if let Some(target) = &anchor.target {
        let trimmed = target.trim();
        if !trimmed.is_empty() && trimmed != "_self" {
            return EligibilityResult::Ineligible {
                reason: IneligibilityReason::TargetNotSelf {
                    target: target.clone(),
                },
            };
        }
    }

    if anchor.download {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::DownloadAttributePresent,
        };
    }

    let href = match &anchor.href {
        Some(h) if !h.trim().is_empty() && !h.trim().starts_with('#') => h.trim(),
        _ => {
            return EligibilityResult::Ineligible {
                reason: IneligibilityReason::EmptyOrFragmentHref,
            };
        }
    };

    let base = ctx.base_uri.as_deref().unwrap_or(&ctx.current_origin);
    let base_parsed = match Url::parse(base) {
        Ok(u) => u,
        Err(e) => {
            return EligibilityResult::Ineligible {
                reason: IneligibilityReason::InvalidUrl {
                    url: base.to_string(),
                    error: e.to_string(),
                },
            };
        }
    };

    let resolved = match base_parsed.join(href) {
        Ok(u) => u,
        Err(e) => {
            return EligibilityResult::Ineligible {
                reason: IneligibilityReason::InvalidUrl {
                    url: href.to_string(),
                    error: e.to_string(),
                },
            };
        }
    };

    let expected_origin = match Url::parse(&ctx.current_origin) {
        Ok(u) => u.origin().ascii_serialization(),
        Err(_) => ctx.current_origin.clone(),
    };

    let actual_origin = resolved.origin().ascii_serialization();
    if actual_origin != expected_origin {
        return EligibilityResult::Ineligible {
            reason: IneligibilityReason::CrossOrigin {
                expected: expected_origin,
                actual: actual_origin,
            },
        };
    }

    EligibilityResult::Eligible {
        intent: FastLinkIntent {
            raw_href: href.to_string(),
            resolved_url: resolved.to_string(),
            pathname: resolved.path().to_string(),
            search: resolved.query().map(|q| format!("?{}", q)).unwrap_or_default(),
            hash: resolved.fragment().map(|f| format!("#{}", f)).unwrap_or_default(),
            origin: actual_origin,
        },
    }
}
