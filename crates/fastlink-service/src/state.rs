use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use prometheus::{Counter, Histogram, Registry, Opts, HistogramOpts};
use lazy_static::lazy_static;
use fastlink_core::{RoutePolicyEngine, RoutePolicyRule, FastNavigationDecision, DocumentMethod};

lazy_static! {
    pub static ref REGISTRY: Registry = Registry::new();

    pub static ref RESOLVE_REQUESTS_TOTAL: Counter = Counter::with_opts(
        Opts::new("fastlink_resolve_requests_total", "Total link resolution requests processed")
    ).unwrap();

    pub static ref PREFETCH_REQUESTS_TOTAL: Counter = Counter::with_opts(
        Opts::new("fastlink_prefetch_requests_total", "Total speculative prefetch requests")
    ).unwrap();

    pub static ref TELEMETRY_EVENTS_TOTAL: Counter = Counter::with_opts(
        Opts::new("fastlink_telemetry_events_total", "Total telemetry events received")
    ).unwrap();

    pub static ref MOUSE_HOLD_DURATION_MS: Histogram = Histogram::with_opts(
        HistogramOpts::new("fastlink_mouse_hold_duration_ms", "Mouse press-to-release hold duration in milliseconds")
            .buckets(vec![20.0, 40.0, 60.0, 80.0, 85.0, 100.0, 120.0, 150.0, 200.0, 300.0, 500.0])
    ).unwrap();
}

pub fn register_metrics() {
    let _ = REGISTRY.register(Box::new(RESOLVE_REQUESTS_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(PREFETCH_REQUESTS_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(TELEMETRY_EVENTS_TOTAL.clone()));
    let _ = REGISTRY.register(Box::new(MOUSE_HOLD_DURATION_MS.clone()));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryPayload {
    pub session_id: Option<String>,
    pub source_path: String,
    pub destination_path: String,
    pub press_duration_ms: u64,
    pub navigation_latency_ms: Option<u64>,
    pub click_suppressed: bool,
    pub was_aborted: bool,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub upstream_origin: Option<String>,
    pub enable_proxy: bool,
    pub auto_inject_client: bool,
    pub script_src: String,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            upstream_origin: None,
            enable_proxy: false,
            auto_inject_client: true,
            script_src: "/fastlink.min.js".to_string(),
        }
    }
}

pub struct AppState {
    pub policy_engine: RwLock<RoutePolicyEngine>,
    pub config: ServiceConfig,
    pub telemetry_log: RwLock<Vec<TelemetryPayload>>,
}

impl AppState {
    pub fn new(config: ServiceConfig) -> Self {
        let mut policy_engine = RoutePolicyEngine::new(FastNavigationDecision::Router { scroll: None });
        policy_engine.add_rule(RoutePolicyRule {
            pattern: "/api/".to_string(),
            decision: FastNavigationDecision::Document { method: DocumentMethod::Assign },
            priority: 100,
            is_prefix: true,
        });
        policy_engine.add_rule(RoutePolicyRule {
            pattern: "/admin".to_string(),
            decision: FastNavigationDecision::Document { method: DocumentMethod::Assign },
            priority: 90,
            is_prefix: true,
        });

        Self {
            policy_engine: RwLock::new(policy_engine),
            config,
            telemetry_log: RwLock::new(Vec::with_capacity(1000)),
        }
    }
}

pub type SharedState = Arc<AppState>;
