# FastLink Troubleshooting & Diagnostic Runbook

This runbook provides systematic root-cause analysis and remediation steps for issues encountered when integrating or operating FastLink.

---

## Diagnostic Matrix

| Issue | Root Cause | Remediation |
|---|---|---|
| **Double Page Navigation** | Follow-up click event is not suppressed, or click listener is unbound. | Verify that `onClickCapture` listener is registered with `{ capture: true }` on `document`. Ensure `event.preventDefault()` is executed when `SUPPRESSED_CLICKS` or `pendingAnchor` matches. |
| **Mobile Scrolling Stutters or Navigates** | `pointerType` check is missing or allows `'touch'`. | Enforce `if (event.pointerType !== 'mouse') return null;` in the eligibility resolver. Mobile browsers must use native gesture inertia. |
| **New Tab (`Cmd`+click) Opens in Same Tab** | Modifier key check is missing or swallowed. | Ensure modifier flags (`metaKey`, `ctrlKey`, `shiftKey`, `altKey`) are checked before handling. Do not call `preventDefault()` when any modifier is active. |
| **Enter Key on Links Does Nothing** | Keyboard click (`detail === 0`) was suppressed. | Ensure click handler explicitly guards: `if (event.detail === 0) return;` so keyboard activation passes through untouched. |
| **Content Security Policy (CSP) Violations** | Inline script or prefetch endpoint blocked by browser CSP headers. | Add FastLink hash or nonce to `script-src`, and add `/api/v1/prefetch` and `/api/v1/telemetry` to `connect-src` in your CSP directive: `connect-src 'self'`. |
| **Prefetch Returns 404 or CORS Error** | Reverse proxy route missing or prefetch endpoint not mounted. | In standalone client mode, ensure `/api/v1/prefetch` is handled by your server or disabled in `fastlink.config.json` via `"prefetch": { "enabled": false }`. |
| **Analytics Beacons Missing Data** | Agent called `event.stopPropagation()` during click suppression. | Never call `stopPropagation()`. FastLink only calls `preventDefault()` on the synthetic click to stop browser navigation while letting analytics tools receive the event. |

---

## Verifying FastLink in the Browser

Open DevTools Console on your instrumented application and inspect:

```javascript
// 1. Verify runtime initialization
console.assert(window.__FAST_LINK_INITIALIZED__ === true, "FastLink failed to initialize");

// 2. Test manual eligibility resolution
const anchor = document.querySelector('a[href]:not([target="_blank"])');
console.log("FastLink eligible target:", anchor ? anchor.href : "No anchor found");

// 3. Inspect telemetry endpoint
console.log("Telemetry configured destination:", window.__FAST_LINK_TELEMETRY__ || "/api/v1/telemetry");
```
