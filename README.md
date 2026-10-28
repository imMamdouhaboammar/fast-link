# FastLink: Framework-Agnostic, Conversion-Safe Navigation & Measurement

FastLink is an open, framework-independent interaction and navigation system engineered specifically for **paid-traffic landing pages and conversion funnels**.

It solves two interconnected challenges in modern web marketing:
1. **Interaction Performance**: Starts eligible prefetches during the mouse press-to-click interval; any actual latency benefit must be measured in the browser.
2. **Measurement Reliability**: Separates interaction attempts from verified outcomes, honors consent, and shares event IDs for deduplication. Delivery and attribution still depend on the browser, collectors, and ad platforms.

---

## The Core Philosophy: Truth in Marketing Measurement

In high-intent conversion funnels, speed must never come at the expense of measurement integrity. FastLink strictly enforces physical separation across the user interaction lifecycle:

```
Pointer Intent (Hold)  ──>  Confirmed Activation (Click / Submit)  ──>  Action / Navigation  ──>  Verified Outcome (Server Confirmed)
  [Hold Timing only]          [CTA Event / Form Attempt]                 [Page Transition]          [Lead / Purchase Event]
  * NO conversion               * NO Lead / Purchase                       * Beacon / Keepalive       * Idempotent Event ID
```

### Inviolable Conversion Invariants
- **Pointer intent is NOT a confirmed click**: `pointerdown` never fires an advertising conversion event.
- **CTA click is NOT a verified lead**: Clicking an external WhatsApp link or a form submit button does not constitute a `Lead`. A `Lead` is emitted only upon verified server confirmation or affirmative outcome.
- **Checkout initiation is NOT a completed purchase**: Clicking a checkout link triggers `InitiateCheckout`. `Purchase` requires verified payment completion.
- **Event queued is NOT event delivered**: Browser beacon queuing indicates buffer acceptance, not transport receipt.
- **Platform receipt is NOT an attributed conversion**: Ad platforms require matching identity graphs and attribution windows to credit a conversion.
- **Never manufacture conversion signals**: FastLink never fabricates synthetic leads to artificially boost campaign vanity metrics.

---

## Where FastLink Helps & Where It Does Not

### Where FastLink Helps
* **Paid-Traffic Landing Pages**: Pages driving traffic from Meta Ads, TikTok Ads, and Google Ads where conversion attribution directly impacts ad spend efficiency.
* **External CTA Links (WhatsApp, Messenger, Phone)**: Preserves native navigation and separates contact intent from verified leads; telemetry delivery is not guaranteed.
* **Multi-Page & Server-Rendered Applications**: WordPress, WooCommerce, Laravel, Django, Rails, and static sites seeking instant transitions without adopting heavy SPA client bundles.
* **Modern SPAs (Next.js, Astro, Remix, Vue, SvelteKit)**: Safely coordinates speculative prefetching with client-side routers without double navigation or analytics starvation.

### Where FastLink Does Not Help
* **Slow Server Backends**: Prefetching cannot compensate for an upstream server taking 3+ seconds to generate dynamic responses.
* **Uncacheable or Highly Personalized Endpoints**: Responses marked `Cache-Control: no-store` or `private` cannot and should not be speculatively prewarmed.
* **Low-Intent Hover Spam**: FastLink does not initiate aggressive prefetching on mouse hover across hundreds of off-screen viewport links, preventing server bandwidth exhaustion.

---

## Navigation Modes

FastLink provides three explicit operational modes:

| Mode | Default | Behavior | Best Used For |
| :--- | :---: | :--- | :--- |
| **`observe`** | No | Read-only observation. Records pointer-to-click hold duration and drag-away aborts. Never prewarms, never modifies navigation, never suppresses clicks. | Baselines, A/B test controls, compliance audits |
| **`safe`** | **Yes** | Speculative prefetching on eligible pointerdown gestures via browser-native Speculation Rules API (or `<link rel="prefetch">`). Navigation waits for confirmed `click` or router hook. Native click propagation is 100% preserved. | Production landing pages, paid funnels, e-commerce |
| **`fast`** | No | Navigates on confirmed primary-mouse `pointerup` **only** for explicitly approved same-origin routes (`fastRoutes` array or `data-fl-fast="true"`), after drag-away cancellation is ruled out. Follow-up clicks are suppressed with `preventDefault()` (never `stopPropagation()`). No measured speed gain is implied. | Opt-in internal routes where pre-click navigation is appropriate |

---

## Advertising Platform Integrations & Consent Gates

FastLink provides lightweight, non-invasive adapters for major advertising platforms:

### 1. Meta Pixel (`fbq`)
Detects official `window.fbq`, respects user consent, and dispatches standard events (`Contact`, `InitiateCheckout`, `Lead`, `Purchase`) or custom events with a unique, matching `eventID` for dual browser/server deduplication.

### 2. TikTok Pixel (`ttq`)
Detects official `window.ttq`, respects user consent, and dispatches tracked events with a matching `event_id`.

### 3. Google Tag Manager (`dataLayer`)
Pushes structured events to `window.dataLayer`:
```javascript
{
  event: "Contact",
  event_id: "fl_1700000000_abc123",
  fastlink: { mode: "safe", cta: "whatsapp", verified: false }
}
```

### 4. Privacy & Consent Boundary
- **Fail-Closed Policy**: If `signals.consent()` returns `false`, `undefined`, or throws, all advertising platform calls are suppressed.
- **Sensitive Parameter Sanitization**: Query parameters such as `token`, `password`, `key`, `secret`, `auth`, `access_token`, and `session_id` are automatically stripped before recording URLs.

---

## Installation & Integration

### A. Static HTML / Vanilla JS
Include the standalone runtime before `</body>`:

```html
<script src="/fastlink.min.js"></script>
<script>
  FastLink.init({
    mode: "safe",
    navigation: {
      prefetch: "same-origin",
      exclude: ["/logout", "/admin/*", "/api/*"]
    },
    signals: {
      collector: "/api/v1/events",
      consent: () => window.hasConsentCookie === true,
      providers: { meta: true, tiktok: true, gtm: true }
    }
  });
</script>

<!-- Scenario A: WhatsApp CTA -->
<a href="https://wa.me/15551234567" data-fl-event="Contact" data-fl-cta="whatsapp" target="_blank">
  Chat on WhatsApp
</a>

<!-- Scenario B: Verified Lead Form -->
<form data-fl-form="quote_request" id="leadForm">
  <input type="email" name="email" required />
  <button type="submit">Get Quote</button>
</form>
<script>
  document.getElementById('leadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/submit', { method: 'POST', body: new FormData(e.target) });
    if (res.ok) {
      // Verified outcome triggers Lead event
      FastLink.recordVerifiedLead({ form_id: 'quote_request' });
    }
  });
</script>

<!-- Scenario C: Checkout Funnel -->
<a href="/checkout" data-fl-event="InitiateCheckout">
  Proceed to Checkout
</a>
```

### B. WordPress & WooCommerce
Drop into `footer.php` or install the provided WordPress plugin in [`examples/wordpress/`](./examples/wordpress/):

```html
<script src="/wp-content/plugins/fastlink/assets/fastlink.min.js" defer></script>
<script>
  window.addEventListener('DOMContentLoaded', function() {
    FastLink.init({
      mode: 'safe',
      navigation: {
        exclude: ['/wp-admin/*', '/wp-login.php*', '/wp-json/*', '/?wc-ajax=*']
      },
      signals: {
        consent: () => typeof wp_has_consent === 'function' ? wp_has_consent('marketing') : false
      }
    });

    // Contact Form 7 integration
    document.addEventListener('wpcf7mailsent', function(event) {
      FastLink.recordVerifiedLead({ form_id: event.detail.contactFormId });
    });
  });
</script>
```

### C. Next.js / React (App Router)
Wrap your root layout with `FastLinkProvider` from [`examples/nextjs-react/`](./examples/nextjs-react/):

```tsx
'use client';
import { FastLinkProvider } from './FastLinkProvider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FastLinkProvider config={{ mode: 'safe' }}>
          {children}
        </FastLinkProvider>
      </body>
    </html>
  );
}
```

---

## Experiment Status: Modeled Inputs, Not Measured Performance

`docs/experiment/run_experiment.ts` creates a seeded synthetic mix of desktop clicks, touch gestures, drag-away attempts, form outcomes, and modifier/auxiliary clicks. It prints the sample distribution and an assumed mouse hold interval using only eligible desktop clicks as the denominator.

**It does not measure navigation latency saved, browser prefetch cache hits, rendering, conversion delivery, or attribution.** No comparative performance win is claimed from this model. See [the experiment protocol](docs/experiment/protocol.md) for measurements still needed.

---

## Optional Backend Microservice (Rust & Go)

FastLink includes optional backend services in Rust (`crates/fastlink-service`) and Go (`go/server`) for teams desiring centralized route policy management, transparent HTML instrumentation, and first-party event collection:

- **`POST /api/v1/events`**: Validates event schemas, logs incoming conversions, and applies in-memory idempotency deduplication.
- **`GET /api/v1/prefetch?url=...`**: Truthfully checks upstream availability and cacheability; never reports simulated hits.
- **`POST /api/v1/policies`**: Protected route policy engine requiring `Authorization: Bearer <FASTLINK_ADMIN_KEY>`.
- **`GET /metrics`**: Exposes Prometheus metrics (`fastlink_telemetry_events_total`, `fastlink_mouse_hold_duration_ms`).

### Running the Services

```bash
# Run Rust microservice
cargo run --release -p fastlink-service

# Run Go gateway
cd go && go run main.go
```

---

## Testing & Verification

FastLink maintains an automated, zero-flakiness test suite across all layers:

```bash
# 1. Run browser client unit & invariant tests (Bun)
bun test tests/client

# 2. Run agent skill evals and gesture invariants
bun run test:skills

# 3. Run Rust core, service, and benchmark tests
cargo test --all

# 4. Run Go gateway tests
cd go && go test -v ./...

# 5. Generate a reproducible synthetic scenario sample (not a benchmark)
bun run docs/experiment/run_experiment.ts --seed=42 --trials=1000
```

---

## License

MIT © Mamdouh Aboammar
