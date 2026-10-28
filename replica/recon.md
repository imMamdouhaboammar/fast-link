# Recon Map: Fast Link (Web, Edge & Microservices)

Scope: Full clean-room reverse engineering of Vercel Labs' Fast Link core link-acceleration engine, eligibility invariants, coordination mechanics, and route decision policy, rebuilt as a high-throughput Rust/Go microservice and edge proxy suite.
For: Modern web platforms, edge gateways, high-performance backends (Go/Rust), and multi-framework web applications.
Date: 2026-10-28

## Evidence & Verification Attribution

- **Target Repository**: `https://github.com/vercel-labs/fast-link` (commit `637d254`)
- **REA Parent Evidence ID**: `ev_933cbae33342fbe6a27efd6251310e2af0f951a1b35de8d754af77b7114c8274`
- **Root Artifact Digest**: `sha256:e70b2eca58620ecb7a7c7798bc30a2d5b4bd6f9d4dc5deb29d6ec02c88db70d7`
- **View Digest**: `sha256:f4f89998fc37e8f8a11015502bf45a46fa9812683d51d19555a653efc446c2a6`
- **AST Corpus**: 122 relevant files, 99 parsed JS/TS files, 44,478 AST nodes, 21,785 data flow relations, 2,064 closures.

## Sources

| # | Source | URL | Notes |
| - | ------ | --- | ----- |
| 1 | GitHub Repository | `https://github.com/vercel-labs/fast-link` | Shipped monorepo source code & public interfaces |
| 2 | Architecture Decision Records | `/tmp/fast-link/docs/adr/0001-0005.md` | Invariants 0001-0005: Separation, Pointerdown, Navigation Decisions, Next routing, Coordination |
| 3 | Performance Benchmark Docs | `/tmp/fast-link/docs/benchmarks.md` | 85ms mouse hold interval benchmark specifications & timings |
| 4 | Core Implementation | `/tmp/fast-link/packages/core/src/` | Interaction eligibility, coordination maps, controller lifecycle |
| 5 | Next & React Adapters | `/tmp/fast-link/packages/next/` & `packages/react/` | App Router integration, `FastLink`, `FastLinkRegion`, `useFastLink` |

## Core Loop

Start navigation on primary mouse press (`pointerdown`) instead of waiting for release (`click`), recovering human hold latency (~85ms to 150ms) with zero layout shifts or false-trigger regressions.

## Screens & Surfaces

| ID | Surface / Screen | Route / How to Reach | Purpose | Key Components | States Seen |
| -- | ---------------- | -------------------- | ------- | -------------- | ----------- |
| S01 | Edge Gateway / Proxy | `GET /` (or reverse proxy path) | Intercept & stream-rewrite HTML to auto-instrument links with Fast-Link directives | HTML Rewriter, Script Injector, Link Filter | Default, Streaming, Passthrough, Error |
| S02 | Speculative Resolve API | `POST /api/v1/resolve` | Evaluate link eligibility, origin boundary, and route policy | URL Validator, Route Policy Matcher | Eligible (Router/Document), Ignored (External, OptOut, Download) |
| S03 | Early Prefetch Pipe | `GET /api/v1/prefetch?url=...` | Stream speculative HTML/RSC chunks or JSON ahead of mouse release | Chunk Cache, Dynamic Handler, Stream Multiplexer | Warm Cache, Cold Fetch, Aborted, Throttled |
| S04 | Telemetry Ingestion | `POST /api/v1/telemetry` | Collect real-world mouse hold durations, navigation latency deltas, and suppression audits | Metric Collector, Aggregator, TSDB/DB storage | Submitted, Batched, Rate-Limited |
| S05 | Live Telemetry & Health Dashboard | `GET /dashboard` | Real-time observability of recovered latency, click suppression rate, and throughput | Metric Cards, Latency Distribution Chart, Health Status | Empty, Live, Filtered, Error |
| S06 | Embedded Client Runtime | `GET /fastlink.min.js` | Universal <1KB vanilla JavaScript runtime supporting all 9 eligibility invariants | Event Listener, Coordination Map, Click Suppressor | Idle, Pressing, Navigating, Suppressing |

## Flows

```
F01 Primary Mouse Navigation (Client -> Edge -> App)
    User presses left mouse button on same-origin link (S06)
    -> pointerdown intercepted at capture phase
    -> All 9 eligibility invariants evaluated synchronously (<0.05ms)
    -> Event marked handled; follow-up click listener registered in coordination map
    -> Immediate speculative prefetch request sent to Microservice (S03)
    -> Navigation initiated via client router or document assign
    -> User releases mouse (~85ms later); browser emits `click`
    -> Follow-up click captured, detail > 0 checked, defaultPrevented called to stop duplicate browser load
    -> Propagation continues for custom handlers
    Happy path clicks: 1 (completed 85ms faster than native)
    Edge cases: user drags away (no click), right/middle click (native), modifier key pressed (new tab), touch/pen input (native gesture preserved).

F02 Reverse Proxy HTML Instrumentation (Server / Edge)
    Client requests page from Origin via Microservice Proxy (S01)
    -> Microservice streams upstream HTML response
    -> Streaming tokenizer detects <a> anchors and navigation regions
    -> Annotates eligible links with `data-fast-link="true"` and appends `/fastlink.min.js` before </body>
    -> Passes downloads, external links, and `data-no-fast-link` anchors untouched
    -> Zero-buffering TTFB preservation.

F03 Server-Side Route Policy & Speculative Prefetch
    Client emits pointerdown ping to S02 / S03
    -> Microservice validates URL against tenant rules and allowed origins
    -> Evaluates route policy: `FastRouterDecision` vs `FastDocumentDecision`
    -> Returns route metadata and initiates background pre-render/cache warm
    -> Response arrives during the 85ms hold interval.
```

## Components

| Component | Variants | States | Used On |
| --------- | -------- | ------ | ------- |
| `FastLink` Element | Anchor, Inline, Card | Default, Hover, Pressed, Navigating, Disabled | S01, S06 |
| `FastLinkRegion` | Container, Nav, Grid | Active, Inherited, Isolated | S01, S06 |
| Stream Rewriter | Passthrough, Transform | Buffering, Streaming, Complete, Error | S01 |
| Telemetry Card | Metric, Rate, Latency | Idle, Updating, Warning, Alert | S05 |
| Health Indicator | Badge | Healthy (200), Degraded, Down | S05 |

## Inferred Data Model

```
RoutePolicy:
  id: uuid
  domain: string
  pattern: string
  decision_kind: 'router' | 'document'
  document_method: 'assign' | 'replace'
  scroll_override: boolean (optional)
  created_at: timestamp
  evidence: packages/core/src/navigation/index.ts, ADR 0003
  confidence: high

NavigationTelemetry:
  id: uuid
  session_id: string
  source_path: string
  destination_path: string
  press_to_release_ms: integer (e.g. 85ms)
  navigation_latency_ms: integer
  click_suppressed: boolean
  was_aborted: boolean (user dragged out without release)
  pointer_type: string ('mouse')
  user_agent: string
  timestamp: timestamp
  evidence: ADR 0002, benchmarks.md
  confidence: high

LinkEligibilityCheck:
  url: string
  is_eligible: boolean
  rejection_reason: string (external_origin | modifier_key | non_mouse | download | opted_out | nested_control | fragment_only)
  evidence: packages/core/src/interaction/index.ts
  confidence: high
```

## Feature Matrix

See `replica/features.csv`.
- Must: 12
- Should: 6
- Could: 3
- Skip: 0

## Out of Scope

- Proprietary internal Vercel CDN deployment scripts (we provide standard Docker / binary / cloud deployment).
- Next.js internal React Server Component (RSC) private bundling protocols (we adhere strictly to public HTTP/gRPC contracts).

## Sizing

- Screens / Endpoints: 6
- Flows: 3
- Entities: 3
- Hard parts: Zero-copy streaming HTML rewriting in Rust, sub-millisecond route policy evaluation, concurrency-safe follow-up click coordination, universal zero-dependency vanilla JS runtime.
- Size: M (Production-grade microservice suite).
