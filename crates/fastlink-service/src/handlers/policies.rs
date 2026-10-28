use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    Json,
};
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
    headers: HeaderMap,
    Json(payload): Json<AddPolicyRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    // Enforce Authorization: Bearer <FASTLINK_ADMIN_KEY>
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    let expected_auth = format!("Bearer {}", state.config.admin_key);
    match auth_header {
        Some(token) if token == expected_auth => {}
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": "unauthorized",
                    "message": "Valid Bearer authorization token required to mutate route policies"
                })),
            );
        }
    }

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
