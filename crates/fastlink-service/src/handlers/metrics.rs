use axum::{
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use prometheus::{Encoder, TextEncoder};
use crate::state::REGISTRY;

pub async fn handle_metrics() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buffer = Vec::new();
    if let Err(e) = encoder.encode(&metric_families, &mut buffer) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            HeaderMap::new(),
            format!("metric encode error: {}", e),
        );
    }

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, encoder.format_type().parse().unwrap());
    (
        StatusCode::OK,
        headers,
        String::from_utf8(buffer).unwrap_or_default(),
    )
}
