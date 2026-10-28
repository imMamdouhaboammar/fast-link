use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::ServiceExt;

use axum::{
    http::{header, HeaderMap},
    routing::get,
    Router,
};
use fastlink_service::state::{AppState, ServiceConfig};
use fastlink_service::{create_app, default_app};
use flate2::{write::GzEncoder, Compression};
use std::io::Write;
use std::sync::Arc;

#[tokio::test]
async fn test_health_check() {
    let app = default_app();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "healthy");
    assert_eq!(json["service"], "fastlink-rs");
}

#[tokio::test]
async fn test_client_js_endpoint() {
    let app = default_app();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/fastlink.min.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response.headers().get("content-type").unwrap();
    assert!(content_type
        .to_str()
        .unwrap()
        .contains("application/javascript"));
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let script = String::from_utf8_lossy(&bytes);
    assert!(script.contains("FastLink Universal Browser Runtime"));
}

#[tokio::test]
async fn test_resolve_endpoint() {
    let app = default_app();
    let payload = serde_json::json!({
        "context": {
            "pointer_type": "mouse",
            "button": 0,
            "modifiers": { "alt": false, "ctrl": false, "meta": false, "shift": false },
            "default_prevented": false,
            "is_handled": false,
            "nested_control": false,
            "nested_button_role": false,
            "current_origin": "https://example.com",
            "base_uri": "https://example.com/docs"
        },
        "anchor": {
            "href": "/docs/install",
            "target": null,
            "download": false,
            "role": null,
            "data_no_fast_link": false
        }
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/resolve")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["eligible"], true);
    assert_eq!(json["intent"]["pathname"], "/docs/install");
    assert_eq!(json["decision"]["kind"], "router");
}

#[tokio::test]
async fn test_prefetch_endpoint_reports_truthfully_without_upstream() {
    let app = default_app();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fdocs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    // Invariant: Must NOT report prewarmed: true when no actual warming occurred
    assert_eq!(json["prewarmed"], false);
    assert_eq!(json["status"], "no_upstream_configured");
}

#[tokio::test]
async fn test_prefetch_endpoint_rejects_excluded_sensitive_route() {
    let app = default_app();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fapi%2Fusers")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Must reject sensitive routes
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "excluded_sensitive_route");
    assert_eq!(json["prewarmed"], false);
}

#[tokio::test]
async fn test_prefetch_endpoint_rejects_mutation_query() {
    let app = default_app();
    for url in [
        "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2F%3Fadd-to-cart%3D123",
        "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2F%2561dmin%2Fsettings",
        "/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fpublic%2F..%2Fadmin%2Fsettings",
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "unsafe prefetch: {url}"
        );
    }
}

#[tokio::test]
async fn test_prefetch_preserves_safe_query_on_actual_upstream_request() {
    let upstream = Router::new().route(
        "/catalog",
        get(|uri: axum::http::Uri| async move {
            if uri.query() == Some("page=2&sort=price") {
                (StatusCode::OK, "correct query")
            } else {
                (StatusCode::BAD_REQUEST, "wrong query")
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
    let app = create_app(Arc::new(AppState::new(ServiceConfig {
        upstream_origin: Some(upstream_origin),
        ..ServiceConfig::default()
    })));
    let response = app.oneshot(
        Request::builder().uri("/api/v1/prefetch?url=https%3A%2F%2Fexample.com%2Fcatalog%3Fpage%3D2%26sort%3Dprice")
            .body(Body::empty()).unwrap(),
    ).await.unwrap();
    server.abort();
    assert_eq!(response.status(), StatusCode::OK);
    let json: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(
        json["status"], "ready",
        "safe query must reach upstream unchanged"
    );
}

#[tokio::test]
async fn test_telemetry_endpoint() {
    let app = default_app();
    let payload = serde_json::json!({
        "source_path": "/",
        "destination_path": "/docs",
        "press_duration_ms": 85,
        "click_suppressed": true,
        "was_aborted": false
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/telemetry")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "recorded");
}

#[tokio::test]
async fn test_events_collector_and_idempotency() {
    let app = default_app();
    let event_payload = serde_json::json!({
        "event_id": "fl_evt_test_unique_001",
        "event_name": "Contact",
        "timestamp_ms": 1700000000000u64,
        "url": "https://example.com/landing",
        "mode": "safe",
        "cta": "whatsapp"
    });

    // First delivery
    let response1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/events")
                .header("content-type", "application/json")
                .body(Body::from(event_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response1.status(), StatusCode::OK);
    let bytes1 = to_bytes(response1.into_body(), usize::MAX).await.unwrap();
    let json1: Value = serde_json::from_slice(&bytes1).unwrap();
    assert_eq!(json1["status"], "received");
    assert_eq!(json1["event_id"], "fl_evt_test_unique_001");

    // Duplicate delivery
    let response2 = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/events")
                .header("content-type", "application/json")
                .body(Body::from(event_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response2.status(), StatusCode::OK);
    let bytes2 = to_bytes(response2.into_body(), usize::MAX).await.unwrap();
    let json2: Value = serde_json::from_slice(&bytes2).unwrap();
    assert_eq!(json2["status"], "deduplicated");
    assert_eq!(json2["event_id"], "fl_evt_test_unique_001");
}

#[tokio::test]
async fn test_metrics_endpoint() {
    let app = default_app();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let metrics = String::from_utf8_lossy(&bytes);
    assert!(metrics.contains("fastlink_resolve_requests_total"));
}

#[tokio::test]
async fn test_policies_endpoint_requires_authorization() {
    let app = create_app(Arc::new(AppState::new(ServiceConfig {
        admin_key: "test-admin-secret".to_string(),
        ..ServiceConfig::default()
    })));
    let payload = serde_json::json!({
        "pattern": "/checkout",
        "decision": { "kind": "document", "method": "assign" },
        "priority": 50,
        "is_prefix": true
    });

    // 1. Missing Authorization header -> 401 Unauthorized
    let unauth_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/policies")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(unauth_response.status(), StatusCode::UNAUTHORIZED);

    // 2. Valid Authorization header -> 201 Created
    let auth_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/policies")
                .header("content-type", "application/json")
                .header("authorization", "Bearer test-admin-secret")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(auth_response.status(), StatusCode::CREATED);
    let bytes = to_bytes(auth_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "policy_added");
}

#[tokio::test]
async fn test_policies_fail_closed_without_admin_key() {
    let app = create_app(Arc::new(AppState::new(ServiceConfig {
        admin_key: String::new(),
        ..ServiceConfig::default()
    })));
    let payload = serde_json::json!({
        "pattern": "/checkout",
        "decision": { "kind": "document", "method": "assign" },
        "priority": 50,
        "is_prefix": true
    });

    for auth in ["Bearer fastlink-admin-secret", "Bearer "] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/policies")
                    .header("content-type", "application/json")
                    .header("authorization", auth)
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn test_proxy_rewrites_gzip_html_and_filters_hop_headers() {
    let upstream = Router::new().route(
        "/html",
        get(|headers: HeaderMap| async move {
            let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
            encoder
                .write_all(b"<html><body><a href='/next'>Next</a></body></html>")
                .unwrap();
            let compressed = encoder.finish().unwrap();
            let mut response = axum::response::Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/html")
                .header(header::CONTENT_ENCODING, "gzip")
                .header(header::ETAG, "\"old-etag\"")
                .header("x-upstream", "preserved")
                .header(header::CONNECTION, "x-response-hop")
                .header("x-response-hop", "remove-me")
                .body(Body::from(compressed))
                .unwrap();
            response.headers_mut().insert(
                "x-request-hop-seen",
                if headers.contains_key("x-request-hop") {
                    "yes"
                } else {
                    "no"
                }
                .parse()
                .unwrap(),
            );
            response
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, upstream).await.unwrap();
    });

    let app = create_app(Arc::new(AppState::new(ServiceConfig {
        upstream_origin: Some(upstream_origin),
        enable_proxy: true,
        auto_inject_client: true,
        ..ServiceConfig::default()
    })));
    let response = app
        .oneshot(
            Request::builder()
                .uri("/html")
                .header(header::CONNECTION, "x-request-hop")
                .header("x-request-hop", "should-not-forward")
                .header(header::ACCEPT_ENCODING, "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    server.abort();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-upstream"], "preserved");
    assert_eq!(response.headers()["x-request-hop-seen"], "no");
    assert!(!response.headers().contains_key("x-response-hop"));
    assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
    assert!(!response.headers().contains_key(header::ETAG));
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(
        html.contains("/fastlink.min.js"),
        "rewriter must receive decoded HTML"
    );
    assert!(html.contains("<a href='/next'"));
}

#[tokio::test]
async fn test_proxy_limits_request_body_and_hides_upstream_errors() {
    let app = create_app(Arc::new(AppState::new(ServiceConfig {
        upstream_origin: Some("http://127.0.0.1:1/private?token=secret".to_string()),
        enable_proxy: true,
        ..ServiceConfig::default()
    })));
    let response = app
        .clone()
        .oneshot(Request::builder().uri("/page").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let message = String::from_utf8_lossy(&body);
    assert!(!message.contains("127.0.0.1") && !message.contains("secret"));

    let large_body = vec![b'x'; 16 * 1024 * 1024 + 1];
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .body(Body::from(large_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn test_events_reject_oversized_identifiers() {
    let app = default_app();
    let payload = serde_json::json!({
        "event_id": "x".repeat(129),
        "event_name": "Contact",
        "timestamp_ms": 1700000000000u64,
    });
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/events")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
