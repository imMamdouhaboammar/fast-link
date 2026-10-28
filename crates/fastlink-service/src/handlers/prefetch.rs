use crate::state::{SharedState, PREFETCH_REQUESTS_TOTAL};
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use url::Url;

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
    State(state): State<SharedState>,
    Query(params): Query<PrefetchQuery>,
) -> impl IntoResponse {
    PREFETCH_REQUESTS_TOTAL.inc();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, "public, max-age=60".parse().unwrap());

    // 1. Validate destination URL
    let parsed_url = match Url::parse(&params.url) {
        Ok(u) => u,
        Err(_) => {
            headers.insert("X-FastLink-Prefetch", "invalid-url".parse().unwrap());
            return (
                StatusCode::BAD_REQUEST,
                headers,
                Json(PrefetchResult {
                    url: params.url,
                    status: "invalid_url".to_string(),
                    prewarmed: false,
                    timestamp_ms: now,
                }),
            );
        }
    };

    let decoded_path = percent_decode_str(parsed_url.path()).decode_utf8_lossy();
    let mut segments: Vec<&str> = Vec::new();
    for segment in decoded_path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            _ => segments.push(segment),
        }
    }
    let normalized_path = format!("/{}", segments.join("/"));
    let path = normalized_path.as_str();
    let mutating_query = parsed_url.query_pairs().any(|(key, _)| {
        matches!(
            key.to_ascii_lowercase().as_str(),
            "add-to-cart" | "wc-ajax" | "action" | "logout" | "_wpnonce" | "remove_item"
        )
    });

    // 2. Reject sensitive mutation, auth, and admin endpoints
    if mutating_query
        || !matches!(parsed_url.scheme(), "http" | "https")
        || parsed_url.host_str().is_none()
        || path.starts_with("/api/")
        || path.starts_with("/auth/")
        || path.starts_with("/admin")
        || path == "/logout"
    {
        headers.insert("X-FastLink-Prefetch", "excluded".parse().unwrap());
        return (
            StatusCode::BAD_REQUEST,
            headers,
            Json(PrefetchResult {
                url: params.url,
                status: "excluded_sensitive_route".to_string(),
                prewarmed: false,
                timestamp_ms: now,
            }),
        );
    }

    // 3. Attempt real cache warming if upstream origin is configured
    if let Some(upstream) = &state.config.upstream_origin {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(1500))
            .build()
            .unwrap_or_default();

        let target_url = format!(
            "{}{}{}",
            upstream.trim_end_matches('/'),
            path,
            parsed_url
                .query()
                .map(|query| format!("?{query}"))
                .unwrap_or_default()
        );
        match client.get(&target_url).send().await {
            Ok(res) => {
                let status_code = res.status();
                if status_code.is_success() {
                    let cache_control = res
                        .headers()
                        .get(header::CACHE_CONTROL)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("");

                    if cache_control.contains("no-store") || cache_control.contains("private") {
                        headers.insert("X-FastLink-Prefetch", "non-cacheable".parse().unwrap());
                        return (
                            StatusCode::OK,
                            headers,
                            Json(PrefetchResult {
                                url: params.url,
                                status: "non_cacheable".to_string(),
                                prewarmed: false,
                                timestamp_ms: now,
                            }),
                        );
                    }

                    headers.insert("X-FastLink-Prefetch", "speculative-hit".parse().unwrap());
                    return (
                        StatusCode::OK,
                        headers,
                        Json(PrefetchResult {
                            url: params.url,
                            status: "ready".to_string(),
                            prewarmed: true,
                            timestamp_ms: now,
                        }),
                    );
                } else {
                    headers.insert("X-FastLink-Prefetch", "upstream-error".parse().unwrap());
                    return (
                        StatusCode::OK,
                        headers,
                        Json(PrefetchResult {
                            url: params.url,
                            status: format!("upstream_status_{}", status_code.as_u16()),
                            prewarmed: false,
                            timestamp_ms: now,
                        }),
                    );
                }
            }
            Err(_) => {
                headers.insert(
                    "X-FastLink-Prefetch",
                    "upstream-unavailable".parse().unwrap(),
                );
                return (
                    StatusCode::OK,
                    headers,
                    Json(PrefetchResult {
                        url: params.url,
                        status: "upstream_unavailable".to_string(),
                        prewarmed: false,
                        timestamp_ms: now,
                    }),
                );
            }
        }
    }

    // When no upstream is configured, report truthfully without simulated prewarmed claims
    headers.insert("X-FastLink-Prefetch", "no-upstream".parse().unwrap());
    (
        StatusCode::OK,
        headers,
        Json(PrefetchResult {
            url: params.url,
            status: "no_upstream_configured".to_string(),
            prewarmed: false,
            timestamp_ms: now,
        }),
    )
}
