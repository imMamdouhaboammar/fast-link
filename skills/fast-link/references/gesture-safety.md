# FastLink Gesture Safety & Accessibility Invariants

Pointerdown navigation provides an 85ms to 150ms performance gain by initiating navigation upon mouse button depression. However, unconstrained pointerdown listening introduces severe accessibility regressions and breaks native browser interactions.

FastLink enforces six strict invariants. Every agent implementing, modifying, or configuring FastLink must strictly preserve these rules.

---

## The 6 Inviolable Invariants

| Invariant | Implementation Check | Rationale & Failure Mode Without Check |
|---|---|---|
| **1. Touch & Stylus Rejection** | `event.pointerType !== 'mouse'` | **Touch Scrolling Hijack**: On touchscreens, users touch links to initiate vertical scrolls. Firing navigation on touch `pointerdown` breaks momentum scrolling and causes unwanted page jumps. |
| **2. Modifiers & Aux Buttons** | `event.button !== 0 \|\| event.metaKey \|\| event.ctrlKey \|\| event.shiftKey \|\| event.altKey` | **New Tab / Context Menu Destruction**: Users hold `Cmd` / `Ctrl` or use middle-click to open links in background tabs. Overriding these forces the current window to navigate, breaking user multitasking. |
| **3. Keyboard Accessibility** | `event.detail === 0` allowed through | **Assistive Tech / Keyboard Trap**: Pressing `Enter` on a focused anchor emits a synthetic `click` with `event.detail === 0` and no preceding `pointerdown`. Keyboard clicks must never be suppressed. |
| **4. Non-Destructive Click Suppression** | `event.preventDefault()` only | **Double Navigation & Analytics Starvation**: Follow-up synthetic clicks must be cancelled via `preventDefault()` to prevent a second request. However, `stopPropagation()` must NOT be called so analytics beacons and custom UI listeners still fire. |
| **5. Drag-Away Abort Handling** | `pointerup` outside anchor boundaries | **False Navigation on Cancellation**: When a user presses the mouse button and realizes they do not wish to navigate, they drag the cursor off the link before releasing. FastLink aborts pending navigation and records telemetry. |
| **6. Opt-Out & Boundary Checks** | `data-no-fast-link`, role, download, target | **Component Encapsulation**: Links marked with `data-no-fast-link`, anchors acting as buttons (`role="button"`), anchors with `download`, external origins, and `target="_blank"` must remain completely native. |

---

## Edge Case Matrix

### 1. Nested Interactive Controls
An anchor containing an interactive child element (e.g. `<a href="/card"><button type="button">Share</button></a>`):
- **Rule**: If `event.target` is or is contained within `button`, `input`, `select`, `textarea`, `summary`, or `[role="button"]`, FastLink marks the event ineligible.
- **Outcome**: The nested control's click handler executes without triggering route navigation.

### 2. Hash-Only Anchors
Anchors with `href="#section"` or `href="#top"`:
- **Rule**: If `href.startsWith('#')`, FastLink skips early navigation.
- **Outcome**: Smooth scrolling and native bookmark jumps execute instantly in-page without server prefetch.

### 3. File Downloads & External Protocols
Anchors with `download` attributes, `mailto:`, `tel:`, or cross-origin URLs:
- **Rule**: Evaluated against base URI. If origin mismatch or non-HTTP/HTTPS protocol detected, early navigation is rejected.
- **Outcome**: Native file download dialogs and operating system protocol handlers launch normally.
