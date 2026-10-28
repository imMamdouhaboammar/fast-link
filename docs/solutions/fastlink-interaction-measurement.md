# Solution: FastLink Interaction & Marketing Measurement Architecture

## Context & Root Causes
FastLink was originally created as an exploration of recovering the human press-to-release hold duration (~85ms to 150ms) between primary mouse `pointerdown` and `click`. However, early implementations committed critical architectural errors:
1. Triggering immediate `window.location.assign()` on `pointerdown` hijacked mobile touch scrolling gestures, broke mouse drag-away cancellations, and bypassed custom click and analytics listeners.
2. The backend prefetch endpoint returned a simulated `{ prewarmed: true }` response without performing any real prefetching or upstream cache warming.
3. Marketing events were conflated: raw pointer gestures were treated as confirmed user intent, and click attempts on lead forms were misclassified as verified conversions.

## Architecture & Invariants Enforced

### 1. Three Explicit Navigation Modes
- **`observe`**: Passive monitoring only. Measures pointer-to-click hold durations, drag-away aborts, and confirmed clicks. Never suppresses native events, never modifies navigation, and never initiates speculative prefetch.
- **`safe` (Default)**: Speculative prefetching on eligible pointerdown gestures via browser-native Speculation Rules API (with `<link rel="prefetch">` fallback). Navigation is deferred until confirmed activation (`click` or framework router hook). Native click propagation is 100% preserved.
- **`fast` (Explicit Opt-In)**: Confirmed primary-mouse release (`pointerup`) on pre-approved same-origin routes (`fastRoutes` or `data-fl-fast="true"`) can initiate navigation before `click`, but never on initial press or after drag-away. Follow-up clicks are suppressed using `event.preventDefault()` exclusively (never `event.stopPropagation()`).

### 2. Marketing Signal Truth & Conversion Lifecycle
We codify the strict lifecycle separation:
```
Pointer Intent (Hold)  ──>  Confirmed Activation (Click / Submit)  ──>  Action / Navigation  ──>  Verified Outcome (Server Confirmed)
  [Hold Timing only]          [CTA Event / Form Attempt]                 [Page Transition]          [Lead / Purchase Event]
  * NO conversion               * NO Lead / Purchase                       * Beacon / Keepalive       * Idempotent Event ID
```
- **Inviolable Invariant**: `pointerdown` must never emit a conversion signal.
- **Form Attempts vs. Leads**: Form submit gestures emit `FormAttempt` (or `InitiateLead`), but never `Lead`. A `Lead` is emitted only upon affirmative server verification.
- **Stable Event Identity**: Every conversion event generates a deterministic or UUID-based `event_id` that is reused across browser pixels (Meta `eventID`, TikTok `event_id`, GTM `event_id`) and first-party server collectors to enable robust dual-delivery deduplication.
- **Consent Gate**: Marketing pixels are dispatched only if `signals.consent()` affirmatively returns `true`. If consent is denied or unknown, advertising signals fail closed.

### 3. Server Collector & Truthful Prefetching
- `POST /api/v1/events` and `POST /api/fastlink/events` validate event payloads and deduplicate incoming `event_id` values via an in-memory idempotency store.
- `GET /api/v1/prefetch`: Validates URLs, rejects excluded mutation/auth paths, queries upstream origin when configured, and truthfully reports `prewarmed: false` when upstream warming is unavailable.
- `POST /api/v1/policies`: Enforces authorization via `Authorization: Bearer <FASTLINK_ADMIN_KEY>`, rejecting unauthorized policy mutations with HTTP 401.

## Verification
- Client invariants and collector tests: `bun test tests/client`.
- FastLink skill evals: `bun run test:skills`.
- Rust service and core tests: `cargo test --all`.
- Go service and proxy tests: `cd go && go test ./...`.
- WordPress collector parsing and validation: `php tests/wordpress/collector_test.php`.
- Synthetic input generator: `bun run docs/experiment/run_experiment.ts --seed=42 --trials=1000`. It cannot demonstrate latency savings or attribution; real browser measurements remain necessary.
