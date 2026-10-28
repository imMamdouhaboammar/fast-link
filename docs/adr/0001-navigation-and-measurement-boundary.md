# ADR 0001: Separation of Navigation Performance and Marketing Measurement

## Status
Accepted

## Context
FastLink originally attempted to accelerate navigation by triggering immediate route transitions on `pointerdown` (~85ms to 150ms before `click`). In doing so, it introduced critical failure modes:
1. **Premature Navigation**: Firing `window.location.assign()` on `pointerdown` navigates the browser away before the user releases the mouse button. If the user initiates a drag-away cancellation or touches a mobile screen to scroll, the gesture is hijacked.
2. **Measurement Starvation & Falsification**: Third-party analytics scripts, marketing pixels (Meta Pixel, TikTok Pixel, Google Tag Manager), and custom event listeners attach to `click` or form `submit`. An immediate `pointerdown` navigation either bypasses these listeners completely, starves them of necessary context, or falsely attributes user intent as a verified conversion.
3. **Simulated vs. Real Acceleration**: The backend prefetch endpoint previously returned `{ prewarmed: true }` unconditionally without querying upstream origins or warming caches.
4. **Architectural Coupling**: The system tightly coupled Rust and Go reverse proxies with client navigation, hindering adoption on modern frameworks (Next.js, Astro, Remix, WordPress, Laravel, static HTML).

## Decision
We decouple FastLink into three independently usable, modular layers with clear invariants:

### 1. Navigation Modes
- **`observe`**: Passive telemetry only. Measures pointer-to-click hold duration, latency, and drag-away aborts. Never modifies navigation and never suppresses click events.
- **`safe` (Default)**: Initiates speculative prefetching (via Speculation Rules API or `<link rel="prefetch">`) on valid pointer intent. Navigation is **never** initiated on `pointerdown`; it waits for the native `click` event or framework router confirmation. Native click propagation is fully preserved.
- **`fast` (Explicit Opt-In)**: Early navigation is strictly restricted to pre-approved, same-origin, non-conversion routes (`fastRoutes` or `data-fl-fast="true"`). Follow-up synthetic clicks are neutralized with `preventDefault()` (never `stopPropagation()`).

### 2. Marketing Signal & Conversion Truth Boundary
We enforce a strict boundary between interaction stages:
```
Pointer Intent (Hold)  ──>  Confirmed Activation (Click / Submit)  ──>  Action / Navigation  ──>  Verified Outcome (Server Confirmed)
  [Hold Timing only]          [CTA Event / Form Attempt]                 [Page Transition]          [Lead / Purchase Event]
  * NO conversion               * NO Lead / Purchase                       * Beacon / Keepalive       * Idempotent Event ID
```
- **Inviolable Invariant**: `pointerdown` must never trigger an advertising conversion event.
- **CTA vs. Lead**: Clicking a WhatsApp CTA link or form submit button does not constitute a `Lead`. A `Lead` is emitted only upon verified server confirmation or explicit affirmative response.
- **Event Identity**: Every conversion event generates a deterministic or UUID-based `event_id` that is reused across browser pixels (Meta `eventID`, TikTok `event_id`, GTM `event_id`) and first-party server collectors to enable robust dual-delivery deduplication.
- **Consent Gate**: Marketing pixels are dispatched only if `signals.consent()` affirmatively returns `true`. If consent is denied or unknown, advertising signals fail closed.

### 3. Real Prefetching & Route Policy Enforcement
- Prefetching utilizes browser-native Speculation Rules when supported, with `<link rel="prefetch">` fallback, gated by network data-saver status (`navigator.connection.saveData`).
- Sensitive routes (`/api/*`, `/auth/*`, `/logout`, `/admin/*`) are unconditionally excluded from prefetch.
- Route policy mutation endpoints (`POST /api/v1/policies`) require `Authorization: Bearer <token>`.
- Prefetch endpoints must only report `prewarmed: true` when upstream caching or prefetching actually succeeded.

## Consequences
- Eliminates touch scroll hijacking and drag-away false navigations.
- Guarantees 100% preservation of third-party analytics and ad pixel events on landing pages.
- Enables seamless integration into static sites, WordPress, PHP, Laravel, Next.js, and other SPAs with zero proxy requirement.
- Accurately reports prefetch and measurement status without simulated falsehoods.
