# Architecture: FastLink Microservice (Rust & Go)

Clean-room architectural specification rebuilding and extending Vercel Labs' Fast Link into a high-throughput, enterprise-ready microservice and edge proxy suite.

## Stack

| Layer | Choice | Why |
| ----- | ------ | --- |
| Rust Core Engine | Rust 1.80+ (`fastlink-core`) | Zero-cost abstractions, memory safety, sub-microsecond link eligibility parsing, zero allocations on happy paths |
| Rust Microservice | Axum + Tokio + Tower (`fastlink-service`) | Async I/O, ergonomic middleware, first-class HTTP/2 and WebSocket streaming support |
| Go Microservice | Go 1.22+ (`fastlink-go`) | Concurrency with goroutines, standard `net/http` reverse proxy, seamless embedding in Go microservices and Kubernetes clusters |
| Edge HTML Rewriter | Streaming HTML Tokenizer (`fastlink-core` / `x/net/html`) | Zero-buffering TTFB-preserving HTML instrumentation for upstream web servers |
| Database / Storage | SQLite / PostgreSQL (ANSI SQL) | Lightweight, single-file zero-configuration local dev with scalable production Postgres migrations |
| Observability | Prometheus + OpenTelemetry Tracing | Native `/metrics` endpoint exposing press hold times, navigation latency deltas, and click suppression rates |
| Client Runtime | Universal Vanilla JS (`fastlink.min.js`) | Zero dependencies, <1KB footprint, works across React, Next.js, Vue, Svelte, Go/Rust SSR templates, and plain HTML |

## Schema

See [`replica/schema.sql`](./schema.sql) for the complete DDL.

Key Tables:
1. `domain_configs`: Configuration per domain (allowed origins, default policies, script injection mode).
2. `route_policies`: Granular URL path patterns matching `FastRouterDecision` vs `FastDocumentDecision`.
3. `telemetry_events`: Ingested real-world interaction records (press duration in ms, navigation latency delta, click suppression status).

## API Contract

| Method & Path | Does | Caller | Input | Output | Flow |
| ------------- | ---- | ------ | ----- | ------ | ---- |
| `POST /api/v1/resolve` | Evaluates link eligibility and server route policy | Client / Edge Worker | JSON `{ url, origin, base_path, button, pointer_type, modifiers, target_attributes }` | JSON `{ eligible: bool, decision: FastNavigationDecision, reason?: string }` | F01, F03 |
| `GET /api/v1/prefetch` | Speculatively serves pre-warmed chunks or route payload | Browser during press hold | Query params `?url=...` | Streamed HTML/JSON payload with caching headers | F01, F03 |
| `POST /api/v1/telemetry` | Ingests mouse hold durations, navigation latencies, and suppression events | Client runtime | JSON `{ session_id, source, destination, press_duration_ms, navigation_latency_ms, click_suppressed, aborted }` | JSON `{ status: 'ok', recorded_at: string }` | F01 |
| `GET /api/v1/policies` | Lists active domain route policies | Admin / Gateway | Query params `?domain=...` | JSON array of `RoutePolicy` | F03 |
| `POST /api/v1/policies` | Creates or updates a route policy | Admin / Configurator | JSON `RoutePolicy` payload | JSON `{ id, status: 'created' }` | F03 |
| `GET /metrics` | Exposes Prometheus latency and throughput metrics | Prometheus Scraper | None | Prometheus text exposition format | Ops |
| `GET /health` | Readiness and liveness health probe | K8s / Load Balancer | None | JSON `{ status: 'healthy', version: '0.1.0' }` | Ops |
| `GET /fastlink.min.js`| Serves the universal vanilla JS client runtime | Public Browsers | None | `application/javascript` with immutable caching | F01, S06 |
| `ALL /*` (Proxy Mode)| Transparent reverse proxy that rewrites upstream HTML | Browser Client | Standard HTTP request forwarded to origin | Streaming instrumented HTML response | F02 |

## The Parts That Bite (Engineering Edge Cases)

1. **Touch & Pen Rejection**:
   - `pointerdown` for touch and stylus devices must never initiate navigation because mobile gestures (pinch zoom, scrolling, swiping, text selection) begin with pointerdown. Reversing navigation after touch scroll starts is physically impossible in browsers.
2. **Click Suppression Race Conditions**:
   - When navigation begins on `pointerdown`, the browser will inevitably dispatch `click` ~85ms later. If not suppressed via `preventDefault()`, the browser triggers a second redundant navigation. If `stopPropagation()` is called, user-defined analytics or click listeners break.
   - Fix: Our microservice and client runtime strictly call `preventDefault()` on the matching follow-up click while allowing event propagation to proceed unimpeded. Detail 0 clicks (keyboard activation) are exempt.
3. **Streaming HTML Rewriting Without Buffering**:
   - Buffering entire HTML documents degrades Time To First Byte (TTFB).
   - Fix: Our Rust and Go proxy rewriters operate as true streaming tokenizers, emitting bytes to the client socket as soon as received from the upstream origin.
4. **Drag-Away / Aborted Navigation**:
   - A user may press the mouse down on a link, change their mind, and drag the pointer outside the window or link before releasing.
   - Fix: Telemetry records `aborted: true` when a pointerup is detected outside the anchor without a subsequent click, allowing developers to measure false-trigger rates.

## Build Order

1. **Phase 1: Pure Domain Core (`fastlink-core`)**
   - Rust structs, enums, URL normalization, the 9 eligibility rules, and `FastNavigationDecision` state machine.
   - Go equivalent structs, invariants, and validation functions.
2. **Phase 2: Microservice Endpoints & Policy Engine**
   - Axum service in Rust + net/http service in Go.
   - `/api/v1/resolve`, `/api/v1/telemetry`, `/metrics`, `/health`.
3. **Phase 3: Streaming Reverse Proxy & HTML Rewriter**
   - Rust and Go proxy middlewares that intercept HTML responses and inject client directives.
4. **Phase 4: Universal Client Runtime (`fastlink.min.js`)**
   - Standalone browser script with coordination maps, WeakSet deduplication, and click suppression.
5. **Phase 5: Verification & Benchmarks**
   - 100% test coverage across Rust and Go engines, sub-microsecond microbenchmarks, and regression test suites.
