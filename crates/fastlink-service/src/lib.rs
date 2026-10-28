pub mod handlers;
pub mod state;

use std::sync::Arc;
use axum::{
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::state::{AppState, ServiceConfig, SharedState};

pub fn create_app(state: SharedState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(handlers::health::handle_health))
        .route("/metrics", get(handlers::metrics::handle_metrics))
        .route("/fastlink.min.js", get(handlers::client_js::handle_client_js))
        .route("/api/v1/resolve", post(handlers::resolve::handle_resolve))
        .route("/api/v1/prefetch", get(handlers::prefetch::handle_prefetch))
        .route("/api/v1/telemetry", post(handlers::telemetry::handle_telemetry))
        .route("/api/v1/events", post(handlers::events::handle_events))
        .route("/api/fastlink/events", post(handlers::events::handle_events))
        .route("/api/v1/policies", post(handlers::policies::handle_add_policy))
        .fallback(handlers::proxy::handle_proxy_fallback)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub fn default_app() -> Router {
    crate::state::register_metrics();
    let config = ServiceConfig::default();
    let state = Arc::new(AppState::new(config));
    create_app(state)
}
