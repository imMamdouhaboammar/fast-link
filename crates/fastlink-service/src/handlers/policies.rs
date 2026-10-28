use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use fastlink_core::{FastNavigationDecision, RoutePolicyRule};
use crate::state::SharedState;

#[derive(Debug, Deserialize, Serialize)]
pub struct AddPolicyRequest {
    pub pattern: String,
    pub decision: FastNavigationDecision,
    pub priority: i32,
    pub is_prefix: bool,
}

pub async fn handle_add_policy(
    State(state): State<SharedState>,
    Json(payload): Json<AddPolicyRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut engine = state.policy_engine.write().await;
    engine.add_rule(RoutePolicyRule {
        pattern: payload.pattern.clone(),
        decision: payload.decision,
        priority: payload.priority,
        is_prefix: payload.is_prefix,
    });

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "status": "policy_added",
            "pattern": payload.pattern
        })),
    )
}
