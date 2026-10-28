# FastLink Technical Configuration Specification

This document defines all runtime configuration options, environment variables, route policies, and telemetry specifications for FastLink.

---

## 1. Environment Variables

When running FastLink as a backend service or reverse proxy container (Rust or Go), the following environment variables configure the service:

| Variable | Type | Default | Description |
|---|---|---|---|
| `FASTLINK_UPSTREAM_ORIGIN` | URL | `http://localhost:3000` | Target upstream server to reverse proxy |
| `FASTLINK_LISTEN_PORT` | Integer | `8080` | Port on which FastLink proxy listens |
| `FASTLINK_ENABLE_PROXY` | Boolean | `true` | Enables transparent upstream reverse proxying |
| `FASTLINK_AUTO_INJECT_CLIENT` | Boolean | `true` | Injects `/fastlink.min.js` before `</body>` |
| `FASTLINK_SCRIPT_SRC` | Path / URL | `/fastlink.min.js` | Public URL for client runtime script |
| `FASTLINK_TELEMETRY_ENDPOINT` | Path / URL | `/api/v1/telemetry` | Destination endpoint for beacon telemetry |
| `FASTLINK_PREFETCH_ENDPOINT` | Path / URL | `/api/v1/prefetch` | Endpoint handling speculative prefetch calls |

---

## 2. Configuration Schema (`fastlink.config.json`)

```json
{
  "$schema": "./fastlink-config.schema.json",
  "version": "1.0.0",
  "mode": "reverse_proxy",
  "proxy": {
    "upstreamOrigin": "http://localhost:3000",
    "autoInjectClient": true,
    "scriptSrc": "/fastlink.min.js",
    "listenPort": 8080
  },
  "prefetch": {
    "enabled": true,
    "endpoint": "/api/v1/prefetch",
    "concurrencyLimit": 6,
    "ignoredPatterns": [
      "/api/*",
      "/auth/*",
      "/logout",
      "/admin/*"
    ]
  },
  "gestureSafety": {
    "rejectTouch": true,
    "preserveModifiers": true,
    "preserveKeyboard": true,
    "suppressDuplicateClick": true
  },
  "routePolicies": [
    {
      "pattern": "/admin/",
      "isPrefix": true,
      "priority": 100,
      "decision": {
        "kind": "document",
        "method": "assign"
      }
    },
    {
      "pattern": "/logout",
      "isPrefix": false,
      "priority": 100,
      "decision": {
        "kind": "disabled"
      }
    },
    {
      "pattern": "/",
      "isPrefix": true,
      "priority": 0,
      "decision": {
        "kind": "router",
        "scroll": true
      }
    }
  ],
  "telemetry": {
    "enabled": true,
    "endpoint": "/api/v1/telemetry",
    "sampleRate": 1.0,
    "recordHoldDuration": true,
    "recordAborts": true
  }
}
```

---

## 3. Route Policy Engine Specifications

FastLink decouples URL routing decisions from frontend components. The policy engine evaluates candidate destinations against an ordered ruleset:

### Decision Kinds

1. **`router`**:
   - Triggers client-side SPA navigation via `window.__FAST_LINK_NAVIGATE__`.
   - Optional parameter: `scroll` (`true` to restore scroll to top; `false` to maintain viewport position).
   - Use for primary application views and client-rendered routes.

2. **`document`**:
   - Triggers native full document navigation.
   - Parameter `method`:
     - `"assign"`: Calls `window.location.assign(url)` (creates new browser history entry).
     - `"replace"`: Calls `window.location.replace(url)` (replaces current history entry).
   - Use for legacy application sections, external auth handoffs, or administrative consoles.

3. **`disabled`**:
   - FastLink skips early navigation entirely for matching URLs.
   - The browser executes standard default `click` mechanics.
   - Use for sensitive endpoints, logouts, payment gateways, or mutation triggers.

### Priority & Pattern Rules
- Rules are sorted in descending order of `priority` (highest integer wins).
- When `isPrefix` is `true`, matches any path starting with `pattern`.
- When `isPrefix` is `false`, requires an exact URL path match.

---

## 4. Telemetry Payload Specification

Client runtime dispatches beacons via `navigator.sendBeacon` (or `fetch keepalive`):

```typescript
interface TelemetryPayload {
  session_id?: string;
  source_path: string;
  destination_path: string;
  press_duration_ms: number;       // Observed mechanical hold interval
  navigation_latency_ms?: number;  // Time to DOMContentLoaded / paint
  click_suppressed: boolean;       // True if follow-up synthetic click was prevented
  was_aborted: boolean;            // True if pointer dragged away before release
  user_agent?: string;
}
```

Prometheus metrics exposed at `/metrics`:
- `fastlink_resolve_requests_total`: Total link resolution calls processed.
- `fastlink_prefetch_requests_total`: Total speculative prefetch requests executed.
- `fastlink_telemetry_events_total`: Total telemetry events logged.
- `fastlink_mouse_hold_duration_ms`: Histogram of mechanical hold intervals (buckets: 20ms to 500ms).
