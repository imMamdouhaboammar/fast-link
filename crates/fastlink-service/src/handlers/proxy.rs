use crate::state::SharedState;
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use fastlink_core::{HtmlRewriter, RewriterOptions};

// Do not forward connection-scoped fields or headers nominated by Connection.
fn is_hop_by_hop(name: &str, nominated: &[String]) -> bool {
    matches!(
        name,
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    ) || nominated.iter().any(|field| field == name)
}

fn connection_tokens(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|value| value.trim().to_ascii_lowercase())
        .collect()
}

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

    let path = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");
    let target_url = format!("{}{}", upstream.trim_end_matches('/'), path);

    let method = reqwest::Method::from_bytes(req.method().as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);

    // 1. Forward permitted request headers
    let mut request_builder = client.request(method.clone(), &target_url);
    let request_tokens = connection_tokens(req.headers());
    for (k, v) in req.headers() {
        if k != header::HOST
            && k != header::CONTENT_LENGTH
            && k != header::ACCEPT_ENCODING
            && !is_hop_by_hop(k.as_str(), &request_tokens)
        {
            request_builder = request_builder.header(k.as_str(), v.as_bytes());
        }
    }

    // 2. Forward request body for non-GET/HEAD methods
    if method != reqwest::Method::GET && method != reqwest::Method::HEAD {
        let body_bytes = match to_bytes(req.into_body(), 16 * 1024 * 1024).await {
            Ok(b) => b,
            Err(_) => {
                return (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    HeaderMap::new(),
                    "Proxied request body exceeded limit or could not be read".to_string(),
                )
                    .into_response();
            }
        };
        request_builder = request_builder.body(body_bytes);
    }

    let res = match request_builder.send().await {
        Ok(r) => r,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                HeaderMap::new(),
                "Upstream request failed".to_string(),
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

    let response_tokens = connection_tokens(res.headers());
    let mut res_headers = HeaderMap::new();
    for (k, v) in res.headers() {
        if k != header::CONTENT_LENGTH && !is_hop_by_hop(k.as_str(), &response_tokens) {
            res_headers.append(k.clone(), v.clone());
        }
    }

    let body_bytes = match res.bytes().await {
        Ok(body) => body,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                HeaderMap::new(),
                "Upstream body read failed".to_string(),
            )
                .into_response()
        }
    };

    let body = if is_html
        && state.config.auto_inject_client
        && method != reqwest::Method::HEAD
        && !res_headers.contains_key(header::CONTENT_ENCODING)
    {
        let body_str = String::from_utf8_lossy(&body_bytes);

        let rewriter = HtmlRewriter::new(RewriterOptions {
            origin: upstream,
            script_src: state.config.script_src.clone(),
            auto_inject_script: true,
        });

        let rewritten = rewriter.rewrite_html(&body_str);
        res_headers.insert(
            header::CONTENT_TYPE,
            "text/html; charset=utf-8".parse().unwrap(),
        );
        // Upstream validators and checksums describe the original, not rewritten, bytes.
        res_headers.remove(header::ETAG);
        res_headers.remove(header::LAST_MODIFIED);
        res_headers.remove("content-md5");
        Body::from(rewritten)
    } else {
        Body::from(body_bytes)
    };
    let mut response = Response::builder().status(status).body(body).unwrap();
    *response.headers_mut() = res_headers;
    response
}
