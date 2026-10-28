use axum::{
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};

const FASTLINK_JS: &str = include_str!("../../../../client/fastlink.js");

pub async fn handle_client_js() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/javascript; charset=utf-8".parse().unwrap());
    headers.insert(header::CACHE_CONTROL, "public, max-age=31536000, immutable".parse().unwrap());
    (StatusCode::OK, headers, FASTLINK_JS)
}
