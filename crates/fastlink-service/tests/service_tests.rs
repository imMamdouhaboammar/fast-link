use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::ServiceExt;

use fastlink_service::default_app;

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
    assert!(content_type.to_str().unwrap().contains("application/javascript"));
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
async fn test_prefetch_endpoint() {
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
    assert_eq!(
        response.headers().get("X-FastLink-Prefetch").unwrap(),
        "speculative-hit"
    );
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["prewarmed"], true);
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
async fn test_policies_endpoint() {
    let app = default_app();
    let payload = serde_json::json!({
        "pattern": "/checkout",
        "decision": { "kind": "document", "method": "assign" },
        "priority": 50,
        "is_prefix": true
    });

    let response = app
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

    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "policy_added");
}
