use fastlink_core::{DocumentMethod, FastNavigationDecision, RoutePolicyEngine, RoutePolicyRule};
use lazy_static::lazy_static;
use prometheus::{Counter, Histogram, HistogramOpts, Opts, Registry};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

lazy_static! {
    pub static ref REGISTRY: Registry = Registry::new();
    pub static ref RESOLVE_REQUESTS_TOTAL: Counter = Counter::with_opts(Opts::new(
        "fastlink_resolve_requests_total",
        "Total link resolution requests processed"
    ))
    .unwrap();
    pub static ref PREFETCH_REQUESTS_TOTAL: Counter = Counter::with_opts(Opts::new(
        "fastlink_prefetch_requests_total",
        "Total speculative prefetch requests"
    ))
    .unwrap();
    pub static ref TELEMETRY_EVENTS_TOTAL: Counter = Counter::with_opts(Opts::new(
        "fastlink_telemetry_events_total",
        "Total telemetry events received"
    ))
    .unwrap();
    pub static ref MOUSE_HOLD_DURATION_MS: Histogram = Histogram::with_opts(
        HistogramOpts::new(
            "fastlink_mouse_hold_duration_ms",
            "Mouse press-to-release hold duration in milliseconds"
        )
        .buckets(vec![
            20.0, 40.0, 60.0, 80.0, 85.0, 100.0, 120.0, 150.0, 200.0, 300.0, 500.0
        ])
    )
    .unwrap();
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
pub struct EventPayload {
    pub event_id: String,
    pub event_name: String,
    pub timestamp_ms: u128,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub cta: Option<String>,
    #[serde(default)]
    pub press_duration_ms: Option<u64>,
    #[serde(default)]
    pub was_aborted: Option<bool>,
    #[serde(default)]
    pub click_suppressed: Option<bool>,
    #[serde(default)]
    pub prefetched: Option<bool>,
    #[serde(default)]
    pub prefetch_method: Option<String>,
    #[serde(default)]
    pub verified: Option<bool>,
    #[serde(default)]
    pub properties: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub upstream_origin: Option<String>,
    pub enable_proxy: bool,
    pub auto_inject_client: bool,
    pub script_src: String,
    pub admin_key: String,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        let admin_key = std::env::var("FASTLINK_ADMIN_KEY").unwrap_or_default();
        Self {
            upstream_origin: std::env::var("FASTLINK_UPSTREAM").ok(),
            enable_proxy: false,
            auto_inject_client: true,
            script_src: "/fastlink.min.js".to_string(),
            admin_key,
        }
    }
}

pub struct AppState {
    pub policy_engine: RwLock<RoutePolicyEngine>,
    pub config: ServiceConfig,
    pub telemetry_log: RwLock<Vec<TelemetryPayload>>,
    pub event_log: RwLock<Vec<EventPayload>>,
    pub recent_event_ids: RwLock<HashSet<String>>,
}

impl AppState {
    pub fn new(config: ServiceConfig) -> Self {
        let mut policy_engine =
            RoutePolicyEngine::new(FastNavigationDecision::Router { scroll: None });
        policy_engine.add_rule(RoutePolicyRule {
            pattern: "/api/".to_string(),
            decision: FastNavigationDecision::Document {
                method: DocumentMethod::Assign,
            },
            priority: 100,
            is_prefix: true,
        });
        policy_engine.add_rule(RoutePolicyRule {
            pattern: "/admin".to_string(),
            decision: FastNavigationDecision::Document {
                method: DocumentMethod::Assign,
            },
            priority: 90,
            is_prefix: true,
        });

        Self {
            policy_engine: RwLock::new(policy_engine),
            config,
            telemetry_log: RwLock::new(Vec::with_capacity(1000)),
            event_log: RwLock::new(Vec::with_capacity(1000)),
            recent_event_ids: RwLock::new(HashSet::with_capacity(1000)),
        }
    }
}

pub type SharedState = Arc<AppState>;
