use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use fastlink_core::{HtmlRewriter, RewriterOptions};
use crate::state::SharedState;

pub async fn handle_proxy_fallback(
    State(state): State<SharedState>,
    req: Request,
) -> impl IntoResponse {
    let upstream = match &state.config.upstream_origin {
        Some(u) => u.clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                HeaderMap::new(),
                "FastLink Service: No upstream configured and route not matched. Direct browser runtime mode is recommended.".to_string(),
            )
                .into_response();
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let path = req.uri().path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let target_url = format!("{}{}", upstream.trim_end_matches('/'), path);

    let method = reqwest::Method::from_bytes(req.method().as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);

    // 1. Forward permitted request headers
    let mut request_builder = client.request(method.clone(), &target_url);
    for (k, v) in req.headers() {
        if k != header::HOST && k != header::CONNECTION && k != header::CONTENT_LENGTH {
            request_builder = request_builder.header(k.as_str(), v.as_bytes());
        }
    }

    // 2. Forward request body for non-GET/HEAD methods
    if method != reqwest::Method::GET && method != reqwest::Method::HEAD {
        let body_bytes = match to_bytes(req.into_body(), usize::MAX).await {
            Ok(b) => b,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    HeaderMap::new(),
                    format!("Failed to read request body: {}", e),
                )
                    .into_response();
            }
        };
        request_builder = request_builder.body(body_bytes);
    }

    let res = match request_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                HeaderMap::new(),
                format!("Upstream error: {}", e),
            )
                .into_response();
        }
    };

    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::OK);
    let is_html = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.contains("text/html"))
        .unwrap_or(false);

    let mut res_headers = HeaderMap::new();
    for (k, v) in res.headers() {
        if k != header::CONTENT_LENGTH && k != header::CONTENT_ENCODING {
            res_headers.insert(k.clone(), v.clone());
        }
    }

    if is_html && state.config.auto_inject_client {
        let body_bytes = res.bytes().await.unwrap_or_default();
        let body_str = String::from_utf8_lossy(&body_bytes);

        let rewriter = HtmlRewriter::new(RewriterOptions {
            origin: upstream,
            script_src: state.config.script_src.clone(),
            auto_inject_script: true,
        });

        let rewritten = rewriter.rewrite_html(&body_str);
        res_headers.insert(header::CONTENT_TYPE, "text/html; charset=utf-8".parse().unwrap());
        Response::builder()
            .status(status)
            .body(Body::from(rewritten))
            .unwrap()
    } else {
        let body_bytes = res.bytes().await.unwrap_or_default();
        Response::builder()
            .status(status)
            .body(Body::from(body_bytes))
            .unwrap()
    }
}
