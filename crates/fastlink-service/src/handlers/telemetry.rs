use axum::{extract::State, http::StatusCode, Json};
use serde_json::json;
use crate::state::{SharedState, TelemetryPayload, MOUSE_HOLD_DURATION_MS, TELEMETRY_EVENTS_TOTAL};

pub async fn handle_telemetry(
    State(state): State<SharedState>,
    Json(payload): Json<TelemetryPayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    TELEMETRY_EVENTS_TOTAL.inc();
    MOUSE_HOLD_DURATION_MS.observe(payload.press_duration_ms as f64);

    let mut log = state.telemetry_log.write().await;
    if log.len() >= 10000 {
        log.remove(0);
    }
    log.push(payload);

    (
        StatusCode::OK,
        Json(json!({
            "status": "recorded",
            "active_samples": log.len()
        })),
    )
}
