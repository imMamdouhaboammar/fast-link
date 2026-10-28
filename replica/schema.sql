-- FastLink Microservice Database Schema
-- Compatible with PostgreSQL and SQLite 3

CREATE TABLE IF NOT EXISTS domain_configs (
    id VARCHAR(64) PRIMARY KEY,
    domain VARCHAR(255) NOT NULL UNIQUE,
    allowed_origins TEXT NOT NULL DEFAULT '',
    fastlink_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    default_decision VARCHAR(32) NOT NULL DEFAULT 'router' CHECK (default_decision IN ('router', 'document')),
    inject_client_script BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_domain_configs_domain ON domain_configs (domain);

CREATE TABLE IF NOT EXISTS route_policies (
    id VARCHAR(64) PRIMARY KEY,
    domain_id VARCHAR(64) NOT NULL REFERENCES domain_configs(id) ON DELETE CASCADE,
    path_pattern VARCHAR(255) NOT NULL,
    decision_kind VARCHAR(32) NOT NULL CHECK (decision_kind IN ('router', 'document')),
    document_method VARCHAR(32) NOT NULL DEFAULT 'assign' CHECK (document_method IN ('assign', 'replace')),
    scroll_override BOOLEAN NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_domain_path_priority UNIQUE (domain_id, path_pattern, priority)
);

CREATE INDEX IF NOT EXISTS idx_route_policies_domain_priority ON route_policies (domain_id, priority DESC);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id VARCHAR(64) PRIMARY KEY,
    domain_id VARCHAR(64) NULL,
    session_id VARCHAR(128) NOT NULL,
    client_ip_hash VARCHAR(64) NOT NULL,
    source_path VARCHAR(1024) NOT NULL,
    destination_path VARCHAR(1024) NOT NULL,
    press_duration_ms INTEGER NOT NULL CHECK (press_duration_ms >= 0),
    navigation_latency_ms INTEGER NOT NULL CHECK (navigation_latency_ms >= 0),
    click_suppressed BOOLEAN NOT NULL DEFAULT TRUE,
    was_aborted BOOLEAN NOT NULL DEFAULT FALSE,
    pointer_type VARCHAR(32) NOT NULL DEFAULT 'mouse',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_domain_created ON telemetry_events (domain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_dest_press ON telemetry_events (destination_path, press_duration_ms);
