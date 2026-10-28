---
name: fast-link
description: >
  Audit, configure, instrument, and verify early pointerdown navigation and speculative
  prefetching across any web project. Initiates route transitions 85ms-150ms earlier than
  standard click events while strictly preserving mobile touch scrolling, keyboard accessibility,
  modifier keys, and telemetry integrity. Use when setting up fast-link, configuring fast navigation
  microservices, accelerating page transitions with pointerdown prefetching, or debugging link routing.
---

# FastLink: Early Pointerdown Navigation & Prefetching

FastLink recovers the mechanical delay between human mouse press (`pointerdown`) and release (`click`), initiating route navigation and speculative prefetching 85ms to 150ms before standard browser click handlers fire.

This skill provides technical specifications and step-by-step procedures for agents to audit, configure, instrument, and verify FastLink across any web architecture.

---

## Operating Modes

| Mode | Trigger Scenario | Primary Action | Reference Guide |
|---|---|---|---|
| **AUDIT** | Evaluate an existing codebase for FastLink readiness | Check link markup, CSP policies, router architecture | `references/troubleshooting.md` |
| **PROXY** | Multi-page app / backend gateway (Go, Rust, Python, PHP, Ruby) | Configure streaming reverse proxy and auto-injection | `references/architecture.md` |
| **SCRIPT** | Static site, CDN, or simple HTML template | Embed zero-dependency runtime `<script src="/fastlink.min.js">` | `references/architecture.md` |
| **SPA** | Modern client router (Next.js, Remix, SvelteKit, Astro, Vue) | Mount `window.__FAST_LINK_NAVIGATE__` router hook | `references/architecture.md` |
| **VERIFY** | Test gestures, keyboard access, modifiers, and telemetry | Run automated invariant test suite and validation scripts | `references/gesture-safety.md` |

---

## Core Workflow Steps

### Step 1: Discover Environment & Router Architecture (Freedom: Low)
1. Inspect the target project to determine whether it is:
   - An MPA or backend monolith (Django, Rails, Laravel, Go, Axum, WordPress) -> Use **PROXY** or **SCRIPT** mode.
   - A static site (Astro, Hugo, 11ty, Vite MPA) -> Use **SCRIPT** mode.
   - A client-routed SPA / SSR meta-framework (Next.js, Remix, SvelteKit, Nuxt) -> Use **SPA** mode.
2. Check Content Security Policy (CSP) headers in server config or `<meta>` tags:
   - Verify `script-src` permits the FastLink runtime script.
   - Verify `connect-src` permits the prefetch (`/api/v1/prefetch`) and telemetry (`/api/v1/telemetry`) endpoints.

### Step 2: Establish Configuration (Freedom: Medium)
1. Generate `fastlink.config.json` at project root matching `assets/fastlink-config.schema.json`.
2. Configure route policies for sensitive endpoints:
   - Set mutation, logout, and auth routes (`/auth/*`, `/logout`, `/api/*`) to decision kind `"disabled"`.
   - Set legacy, external, or document-download paths to decision kind `"document"` with method `"assign"`.
   - Set internal application routes to decision kind `"router"`.
3. Validate configuration schema:
   ```bash
   bun skills/fast-link/scripts/validate_fastlink_config.ts fastlink.config.json
   ```

### Step 3: Implement Runtime & Invariants (Freedom: Low)
Incorporate the runtime following the chosen architecture mode:

#### SCRIPT Mode (Direct HTML Tag)
Deploy `assets/fastlink.min.js` to public assets and reference before `</body>`:
```html
<script src="/fastlink.min.js" defer></script>
```

#### SPA Mode (Router Adapter)
Mount the navigation hook during root layout initialization:
```typescript
if (typeof window !== 'undefined') {
  window.__FAST_LINK_NAVIGATE__ = (intent) => {
    appRouter.push(intent.url.pathname + intent.url.search + intent.url.hash);
  };
}
```

#### PROXY Mode (Reverse Proxy)
Run the FastLink reverse proxy container pointing to your upstream backend:
- Set `FASTLINK_UPSTREAM_ORIGIN` to backend server URL.
- Set `FASTLINK_AUTO_INJECT_CLIENT=true`.

### Step 4: Enforce Gesture Safety Invariants (Freedom: Low)
Every implementation must preserve the 6 Inviolable Invariants documented in `references/gesture-safety.md`:
1. **Touch Rejection**: Must check `event.pointerType === 'mouse'`. Never trigger on touch or pen to prevent mobile scroll hijacking.
2. **Modifier Passthrough**: Must ignore events when `event.button !== 0` or `metaKey`, `ctrlKey`, `shiftKey`, `altKey` are pressed, ensuring native new tab/window functionality remains intact.
3. **Keyboard Preservation**: Must never suppress click events where `event.detail === 0` (Enter key or assistive technologies).
4. **Click Suppression**: Must call `event.preventDefault()` on synthetic followup clicks to prevent double navigation, but must NEVER call `event.stopPropagation()` so analytics and trackers continue functioning.
5. **Drag-Away Abort**: Must detect pointer release outside target anchor and abort pending navigation.
6. **Opt-Out Directives**: Must honor `data-no-fast-link`, `role="button"`, `target="_blank"`, and `download`.

### Step 5: Verify & Benchmark (Freedom: Low)
1. Execute the gesture invariants test suite:
   ```bash
   bun skills/fast-link/scripts/verify_gesture_invariants.ts
   ```
2. Verify telemetry emission via DevTools Network tab or Prometheus `/metrics` endpoint.
3. Measure hold duration distribution: typical values fall between 85ms and 150ms.

---

## Stop Conditions & Recovery

| Condition | Action |
|---|---|
| Target application relies on touch-only mobile webviews | Disable FastLink pointerdown handler; fall back to standard browser navigation. |
| Strict CSP forbids external script and inline nonce generation | Bundle `fastlink.min.js` directly into client application build pipeline. |
| Synthetic click fails to cancel, causing dual page requests | Verify `{ capture: true }` is enabled on click listener and ensure event is added to `SUPPRESSED_CLICKS`. |
