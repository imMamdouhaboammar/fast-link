# Fix Plan & Positioning: FastLink Microservice

Grounded in real feedback from 10 reviews across 3 sources (Hacker News, Reddit, GitHub).

## 1. What They Hate (Complaints)

1. **Touch / Pen False Triggers & Gesture Breaking**:
   - Problem: Trying to accelerate mobile navigation on touchstart breaks scrolling, swiping, and pinch-to-zoom because contact intent cannot be determined at touchstart.
   - Evidence: 2 reviews across Hacker News and GitHub.
   - Quote: *"Mobile devices lack a hover state, but starting navigation on touchstart is broken because you cannot distinguish scrolling or swiping from a tap."* (HN, 2-star, [link](https://news.ycombinator.com/item?id=28900411))
2. **Phantom Clicks & Broken Analytics**:
   - Problem: Early navigation triggering before release creates duplicate navigation or swallows custom tracking handlers when click suppression is implemented naively.
   - Evidence: 1 review on Hacker News.
   - Quote: *"Our analytics were completely skewed by phantom clicks when early navigation libraries didn't cleanly suppress the follow-up click or swallowed custom handlers."* (HN, 2-star, [link](https://news.ycombinator.com/item?id=38120011))

## 2. What Is Missing (Feature Demands)

1. **Server-Side & Edge Proxy Auto-Instrumentation**:
   - Demand: Developers running non-Next.js backends (Go, Rust, Rails, Django, static HTML) want early navigation without bundling large client libraries.
   - Evidence: 2 reviews across HN and Reddit.
   - Quote: *"Why can't we have an edge proxy that automatically rewrites links and handles speculative prefetching for non-Next.js apps like Go or Rust backends?"* (Reddit, 3-star, [link](https://www.reddit.com/r/webdev/comments/17fastl/link_prefetching_performance/))
2. **Press-to-Release Hold Telemetry**:
   - Demand: Quantifiable measurement of human hold time (~85ms) and latency savings in production.
   - Evidence: 1 review on HN.
   - Quote: *"There's no option in most client libraries to record actual press-to-release hold latency telemetry so you are flying blind on how much time you actually save."* (HN, 4-star, [link](https://news.ycombinator.com/item?id=34201192))
3. **Centralized Route Policy Management**:
   - Demand: Decoupling route ownership and document fallback from hardcoded client-side components into a centralized microservice engine.
   - Evidence: 1 review on HN.
   - Quote: *"We need a microservice architecture where route ownership policies can be defined centrally instead of hardcoding route lists in client components."* (HN, 3-star, [link](https://news.ycombinator.com/item?id=26543210))

## 3. What Is Unsolved (Positioning Opportunities)

- Existing solutions (Next.js Link, InstantClick, Quicklink, Flying Pages) either aggressively over-fetch on viewport/hover (wasting server CPU and bandwidth) or are strictly locked into React/Next.js client codebases.
- Nobody has built a **high-throughput Rust / Go microservice & reverse proxy** that pairs zero-allocation streaming HTML link injection with sub-millisecond route resolution, speculative streaming, and hold telemetry.

## 4. The Fix Plan

| # | Fix / Capability | Size | Implemented In | Evidence Grounding |
| - | ---------------- | ---- | -------------- | ------------------ |
| 1 | Strict pointerType === 'mouse' gate to completely protect mobile touch gestures | S | `fastlink-core` & client | ADR 0002 & HN #28900411 |
| 2 | Clean follow-up click suppression calling `preventDefault()` while keeping event propagation | S | `fastlink-core` & client | HN #38120011 |
| 3 | Streaming HTML Rewriter middleware in Rust & Go (zero buffering, TTFB preserving) | M | `fastlink-service` & `fastlink-go` | Reddit #17fastl |
| 4 | Speculative Route & Policy Resolution API (`POST /api/v1/resolve`) | S | `fastlink-service` & `fastlink-go` | HN #26543210 |
| 5 | Telemetry Ingestion endpoint (`POST /api/v1/telemetry`) & Prometheus metrics exporter | S | `fastlink-service` & `fastlink-go` | HN #34201192 |
| 6 | Standalone zero-dependency universal browser runtime (<1KB, `fastlink.min.js`) | S | Client runtime | HN #37500120 |

## 5. The Angle

- **Option A (The Edge Gateway Angle)**:
  *For high-traffic web applications built with Go, Rust, or multi-page frameworks that hate slow page transitions and heavy client bundles, FastLink is a streaming reverse-proxy microservice that automatically accelerates links on mouse press with zero manual frontend refactoring.*
- **Option B (The Enterprise Telemetry & Route Intelligence Angle)**:
  *For engineering teams managing complex micro-frontends who need centralized routing control and real proof that early navigation works, FastLink is a high-speed policy engine and telemetry service that measures human press latency and routes link intents at microsecond speeds.*
- **Option C (The Universal Performance Angle - Recommended)**:
  *For developers building modern web apps who want Vercel Fast-Link's 85ms navigation acceleration across ANY backend (Go, Rust, Node, Python) without framework lock-in, FastLink is the ultra-fast Rust/Go microservice and lightweight runtime suite that accelerates link navigation on mouse press.*

**Recommended Angle:** Option C.
