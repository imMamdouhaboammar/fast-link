use axum::{extract::State, http::StatusCode, Json};
use serde_json::json;
use crate::state::{EventPayload, SharedState, TELEMETRY_EVENTS_TOTAL};

pub async fn handle_events(
    State(state): State<SharedState>,
    Json(payload): Json<EventPayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    if payload.event_id.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing or empty 'event_id'" })),
        );
    }

    if payload.event_name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing or empty 'event_name'" })),
        );
    }

    if payload.timestamp_ms == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid 'timestamp_ms'" })),
        );
    }

    let mut event_ids = state.recent_event_ids.write().await;
    if event_ids.contains(&payload.event_id) {
        return (
            StatusCode::OK,
            Json(json!({
                "status": "deduplicated",
                "event_id": payload.event_id
            })),
        );
    }

    // Bounded capacity protection: prune oldest if capacity exceeds limit
    if event_ids.len() >= 10000 {
        event_ids.clear();
    }
    event_ids.insert(payload.event_id.clone());

    TELEMETRY_EVENTS_TOTAL.inc();

    let mut log = state.event_log.write().await;
    if log.len() >= 10000 {
        log.clear();
    }
    let event_id = payload.event_id.clone();
    log.push(payload);

    (
        StatusCode::OK,
        Json(json!({
            "status": "received",
            "event_id": event_id
        })),
    )
}
