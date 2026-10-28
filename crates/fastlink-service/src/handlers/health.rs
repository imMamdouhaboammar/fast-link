use axum::Json;
use serde_json::json;

pub async fn handle_health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "fastlink-rs",
        "version": env!("CARGO_PKG_VERSION")
    }))
}
