use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use fastlink_core::{
    resolve_fast_link, AnchorAttributes, FastLinkIntent, FastNavigationDecision, IneligibilityReason,
    InteractionContext,
};
use crate::state::{SharedState, RESOLVE_REQUESTS_TOTAL};

#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    pub context: InteractionContext,
    pub anchor: AnchorAttributes,
}

#[derive(Debug, Serialize)]
pub struct ResolveResponse {
    pub eligible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent: Option<FastLinkIntent>,
    pub decision: FastNavigationDecision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<IneligibilityReason>,
}

pub async fn handle_resolve(
    State(state): State<SharedState>,
    Json(payload): Json<ResolveRequest>,
) -> Json<ResolveResponse> {
    RESOLVE_REQUESTS_TOTAL.inc();

    let eligibility = resolve_fast_link(&payload.context, &payload.anchor);
    match eligibility {
        fastlink_core::EligibilityResult::Eligible { intent } => {
            let engine = state.policy_engine.read().await;
            let decision = engine.resolve(&intent);
            Json(ResolveResponse {
                eligible: true,
                intent: Some(intent),
                decision,
                reason: None,
            })
        }
        fastlink_core::EligibilityResult::Ineligible { reason } => {
            Json(ResolveResponse {
                eligible: false,
                intent: None,
                decision: FastNavigationDecision::Document {
                    method: fastlink_core::DocumentMethod::Assign,
                },
                reason: Some(reason),
            })
        }
    }
}
