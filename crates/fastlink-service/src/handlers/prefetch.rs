use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::state::{SharedState, PREFETCH_REQUESTS_TOTAL};

#[derive(Debug, Deserialize)]
pub struct PrefetchQuery {
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct PrefetchResult {
    pub url: String,
    pub status: String,
    pub prewarmed: bool,
    pub timestamp_ms: u128,
}

pub async fn handle_prefetch(
    State(_state): State<SharedState>,
    Query(params): Query<PrefetchQuery>,
) -> impl IntoResponse {
    PREFETCH_REQUESTS_TOTAL.inc();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let result = PrefetchResult {
        url: params.url,
        status: "ready".to_string(),
        prewarmed: true,
        timestamp_ms: now,
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, "public, max-age=60".parse().unwrap());
    headers.insert("X-FastLink-Prefetch", "speculative-hit".parse().unwrap());

    (StatusCode::OK, headers, Json(result))
}
