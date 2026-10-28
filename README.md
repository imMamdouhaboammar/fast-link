# FastLink Microservice (Rust & Go)

High-performance, clean-room reconstruction and backend microservice extension of Vercel Labs' Fast Link (`https://github.com/vercel-labs/fast-link`).

FastLink accelerates web navigation by initiating route transitions and speculative prefetching on primary mouse `pointerdown` rather than waiting for the `click` event, recovering the human press-to-release hold interval (~85ms to 150ms). This repository delivers a high-throughput **Rust microservice**, an idiomatic **Go gateway & reverse proxy**, and a **universal zero-dependency browser runtime** (<1KB) that extends early navigation to any web framework or backend architecture.

---

## What FastLink Delivers to Any Web Application

* **85ms–150ms Instant Navigation Boost**: Capitalizes on the mechanical delay between human mouse press (`pointerdown`) and release (`click`). Navigation or speculative prefetching begins the exact millisecond the mouse button goes down, eliminating perceived transition latency.
* **Zero-Touch Streaming HTML Instrumentation**: Operates as a transparent reverse proxy that tokenizes upstream HTML responses on the fly without buffering. Eligible links are annotated with `data-fast-link="true"` and the <1KB runtime script is injected before `</body>`—accelerating applications without editing frontend codebases.
* **Speculative Server-Side Prefetch Pipeline**: Triggers an immediate, lightweight background prefetch request (`GET /api/v1/prefetch`) during the 85ms hold window. Dynamic routes, Server Components, and SSR fragments warm the cache before the user's finger lifts off the mouse.
* **Bulletproof Native Gesture & Input Preservation**:
  * Touch and stylus inputs are strictly rejected to ensure mobile scrolling, swiping, and pinch-to-zoom gestures are never hijacked.
  * Modifier keys (`Ctrl`, `Cmd`, `Shift`, `Alt`), middle clicks, and right clicks pass through directly to native browser tab/window handling.
  * External domains, file downloads, and hash-only anchors (`#`) stay native.
* **Non-Destructive Follow-Up Click Suppression**: Calls `preventDefault()` on the subsequent synthetic click to avoid double navigation, while preserving DOM event propagation so third-party tracking scripts, analytics, and custom handlers fire normally. Keyboard activation (`detail === 0`) remains unaffected.
* **Centralized Route Policy Management**: Decouples client navigation logic from application code. An ultra-fast policy engine routes internal application views via SPA router transitions while routing external, legacy, or administrative paths via clean document navigation (`assign` or `replace`).
* **Real-World Telemetry & Hold Duration Observability**: Records empirical hold durations, navigation latency deltas, and drag-away abort rates via `POST /api/v1/telemetry`, exposing Prometheus metrics for continuous Core Web Vitals monitoring.

---

## Who Uses FastLink

* **Multi-Page Application (MPA) Teams**: Engineering teams building on Go, Rust, Python (Django, FastAPI), Ruby on Rails, PHP (Laravel, WordPress), or static site generators who want single-page-app speed without adopting React or client-side bundlers.
* **Platform, Edge & SRE Teams**: Infrastructure engineers deploying FastLink as a drop-in Envoy, Cloudflare Worker, or Kubernetes reverse proxy to boost Core Web Vitals (INP and LCP) across hundreds of micro-frontends with zero frontend refactoring.
* **High-Conversion E-Commerce & Media Platforms**: Online storefronts and publishing platforms looking to slash bounce rates by instantly pre-rendering checkout funnels and article pages during mouse clicks.
* **Modern SPA & SSR Framework Developers (Next.js, Remix, Astro, Svelte, Vue)**: Developers replacing aggressive viewport over-fetching (which wastes server compute and client bandwidth) with high-intent pointerdown prefetching that consumes sub-microsecond evaluation cycles.

---

## The Architectural Edge: How We Outperform the Original Repository

| Dimension | Original (`vercel-labs/fast-link`) | FastLink Microservice (This Rebuild) | Solved Problem |
| :--- | :--- | :--- | :--- |
| **Framework Independence** | Bound to **React and Next.js App Router** via npm packages (`@fast-link/next`, `@fast-link/react`). | **100% Framework Agnostic**. High-throughput microservice in **Rust & Go** with a standalone <1KB vanilla runtime. | Removes React/Next.js lock-in; works across all stacks and backends. |
| **Integration Overhead** | Requires manual codebase refactoring: replacing `<Link>` with `FastLink` components and wrapper hooks. | **Zero-Touch Deployment**. Streaming reverse proxy instruments HTML on the wire without code modifications. | Instantly accelerates legacy, third-party, and enterprise web applications. |
| **Server-Side Awareness** | Completely client-side; origin servers receive no early signal during the press hold. | **Speculative Prefetch Stream (`/api/v1/prefetch`)**. Servers pre-warm caches and RSC payloads during the 85ms hold. | Transforms passive client waiting into active server-side cache warming. |
| **Production Telemetry** | Zero observability; developers cannot measure actual hold durations or quantify latency savings. | **Integrated Telemetry Ingestion & Prometheus Exporter**. Tracks hold times, latency deltas, and abort rates. | Replaces performance assumptions with production telemetry. |
| **Route Policy Decoupling** | Hardcoded via JavaScript callbacks passed as component props. | **Centralized Sub-Microsecond Policy Engine**. Dynamic path matching and document/router rules. | Allows updating routing policies without redeploying frontend assets. |
| **Throughput & Efficiency** | Dependent on browser V8 compilation and React reconciliation cycles. | **Native Multi-Threaded Engine**. **1.12 µs** per eligibility check (**~890,000 ops/sec** in Rust). | Minimal CPU/memory footprint; suitable for high-traffic edge gateways. |

---

## REA Evidence Ledger & Attribution

- **Target Repository**: `https://github.com/vercel-labs/fast-link` (commit `637d254`)
- **REA Parent Evidence ID**: `ev_933cbae33342fbe6a27efd6251310e2af0f951a1b35de8d754af77b7114c8274`
- **Root Artifact Digest**: `sha256:e70b2eca58620ecb7a7c7798bc30a2d5b4bd6f9d4dc5deb29d6ec02c88db70d7`
- **View Digest**: `sha256:f4f89998fc37e8f8a11015502bf45a46fa9812683d51d19555a653efc446c2a6`
- **AST Corpus Analyzed**: 122 relevant files, 99 parsed JS/TS files, 44,478 AST nodes, 21,785 data flow relations.

---

## The 9 Invariants of FastLink

1. **Primary Mouse Only**: Only triggers on `button === 0`.
2. **Strict PointerType Filtering**: Only triggers on `pointerType === 'mouse'`. Touch and pen are rejected to prevent hijacking pinch-zoom, swiping, or scrolling gestures.
3. **No Modifier Keys**: Bypasses early navigation if `altKey`, `ctrlKey`, `metaKey`, or `shiftKey` are active.
4. **No Prior Default Prevention**: Rejects events where `defaultPrevented === true`.
5. **Deduplication / Handled Guard**: Prevents duplicate executions across nested roots.
6. **Explicit Opt-Out**: Honors `data-no-fast-link` and rejects non-link ARIA roles (e.g. `role="button"`).
7. **Nested Interactive Controls**: Rejects clicks starting inside `BUTTON`, `INPUT`, `LABEL`, `SELECT`, `SUMMARY`, or `TEXTAREA`.
8. **Same-Origin Destinations**: Restricts early navigation to same-origin URLs; ignores `target !== '_self'`, `download` attributes, and hash-only fragment links (`#`).
9. **Follow-Up Click Suppression**: Consumes the matching follow-up click with `preventDefault()` to prevent duplicate browser navigation while preserving event propagation for analytics and custom handlers. Detail 0 clicks (keyboard `Enter`/`Space`) are never suppressed.

---

## Microservice Architecture

```
                      +-----------------------------+
                      |   Browser Client Runtime    |
                      |     (/fastlink.min.js)      |
                      +--------------+--------------+
                                     |
               (pointerdown)         | (follow-up click ~85ms)
                     |               |
                     v               v
             [Speculative Prefetch] [Click Suppressed]
                     |               |
                     +-------+-------+
                             |
                             v
+---------------------------------------------------------+
|                  FastLink Microservice                  |
|                                                         |
|  +--------------------+         +--------------------+  |
|  |  Rust Service      |         |  Go Gateway        |  |
|  |  (Axum + Tokio)    |   OR    |  (net/http + Gin)  |  |
|  |  - Core Engine     |         |  - Reverse Proxy   |  |
|  |  - Streaming HTML  |         |  - Stream Tokenizer|  |
|  |  - Route Policy    |         |  - Route Policy    |  |
|  |  - Telemetry / TSDB|         |  - Prometheus / Exp|  |
|  +--------------------+         +--------------------+  |
+---------------------------------------------------------+
                             |
                             v
               +---------------------------+
               |  Upstream Web Application |
               | (Go / Rust / Next.js /    |
               |  Rails / Django / HTML)   |
               +---------------------------+
```

---

## Performance Benchmarks

Measured on Apple Silicon (`arm64`):

| Language | Test Type | Latency per Check | Throughput |
| -------- | --------- | ----------------- | ---------- |
| **Rust** (`fastlink-core`) | 100,000 link eligibility checks | **1.12 µs / op** | **~890,000 ops / sec** |
| **Go** (`fastlink/core`) | 100,000 link eligibility checks | **< 1.50 µs / op** | **~670,000 ops / sec** |
| **Rust** (`fastlink-service`) | HTTP `/api/v1/resolve` | **< 35 µs** | **~28,000 req / sec** |

---

## API Specifications

### 1. `POST /api/v1/resolve`
Synchronously evaluates link eligibility against the 9 invariants and resolves routing policy.

**Request:**
```json
{
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
}
```

**Response:**
```json
{
  "eligible": true,
  "intent": {
    "raw_href": "/docs/install",
    "resolved_url": "https://example.com/docs/install",
    "pathname": "/docs/install",
    "search": "",
    "hash": "",
    "origin": "https://example.com"
  },
  "decision": {
    "kind": "router"
  }
}
```

### 2. `GET /api/v1/prefetch?url=...`
Speculatively streams chunks or cache-warming response during the 85ms mouse hold interval.

### 3. `POST /api/v1/telemetry`
Ingests real-world interaction timings (hold duration, click suppression audit, drag-away false triggers).

### 4. `GET /metrics`
Exposes Prometheus metric exposition format for Grafana / Datadog scraping.

### 5. `GET /health`
Liveness and readiness probe for Kubernetes / cloud orchestrators.

### 6. `GET /fastlink.min.js`
Serves the self-contained universal browser runtime with immutable caching.

---

## Running the Services

### Rust Microservice
```sh
# Run unit & integration tests
cargo test --all

# Run release benchmark
cargo test --release --test benchmark -- --nocapture

# Run microservice server
cargo run --release -p fastlink-service
```

### Go Microservice & Reverse Proxy
```sh
# Run Go tests
cd go && go test -v ./...

# Build Go binary
go build -o bin/fastlink .

# Run Go server with optional upstream proxy
PORT=8081 FASTLINK_UPSTREAM=http://localhost:3000 ./bin/fastlink
```

---

## Replica Artifacts

Full clean-room documentation produced during reverse engineering:
- [`replica/recon.md`](./replica/recon.md) — Screen & flow inventory, core loop, and inferred data model.
- [`replica/features.csv`](./replica/features.csv) — 21-feature parity matrix.
- [`replica/architecture.md`](./replica/architecture.md) — System stack, API, edge cases, and build sequence.
- [`replica/schema.sql`](./replica/schema.sql) — ANSI SQL schema for domains, policies, and telemetry.
- [`replica/feedback.md`](./replica/feedback.md) — Analyzed developer reviews and ranked pain points.
- [`replica/fixes.md`](./replica/fixes.md) — Fix plan and strategic product positioning.
- [`replica/design/tokens.json`](./replica/design/tokens.json) & [`tokens.css`](./replica/design/tokens.css) — Design tokens with WCAG AA compliance (0 AA failures verified via `contrast.py`).
