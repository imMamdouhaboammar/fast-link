use std::net::SocketAddr;
use std::sync::Arc;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use fastlink_service::create_app;
use fastlink_service::state::{register_metrics, AppState, ServiceConfig};

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fastlink_service=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    register_metrics();

    let upstream = std::env::var("FASTLINK_UPSTREAM").ok();
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let admin_key = std::env::var("FASTLINK_ADMIN_KEY").unwrap_or_else(|_| "fastlink-admin-secret".to_string());

    let config = ServiceConfig {
        upstream_origin: upstream,
        enable_proxy: true,
        auto_inject_client: true,
        script_src: "/fastlink.min.js".to_string(),
        admin_key,
    };

    let shared_state = Arc::new(AppState::new(config));
    let app = create_app(shared_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("FastLink Rust microservice listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
