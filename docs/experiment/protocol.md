# FastLink Performance & Measurement Experiment Protocol

## Objective
Establish a reproducible, controlled empirical benchmark comparing navigation performance and measurement reliability across three configurations:

1. **Variant A (Control)**: Standard native browser navigation with conventional third-party pixel installations.
2. **Variant B (Naive FastLink / Unconstrained Pointerdown)**: Early navigation initiated immediately on `pointerdown` without measurement coordination or consent gates.
3. **Variant C (FastLink Safe)**: Speculative prefetch on pointer intent, confirmed click preservation, consent-aware ad signal adapters, and verified lead/purchase lifecycle separation.

---

## Metric Definitions & Observable Telemetry

### A. Interaction & Navigation Performance
- **Press Hold Interval ($\Delta t_{\text{hold}}$)**: Duration in milliseconds between physical primary mouse press (`pointerdown`) and release (`click`). Typically ranges between 85ms and 150ms on desktop.
- **Speculative Prefetch Hit Rate**: Percentage of navigation transitions where the destination document was prefetched and served from memory/HTTP cache during the hold interval.
- **Prefetch Waste Rate**: Percentage of speculative prefetch requests initiated that were aborted or never converted into an actual navigation (e.g. drag-away cancellations).
- **Perceived Transition Latency ($\Delta t_{\text{visible}}$)**: Milliseconds from human click confirmation to the first meaningful paint of the destination view.

### B. Marketing Measurement Reliability
- **Touch Gesture Hijack Rate**: Percentage of mobile touchscreen interactions (e.g. scroll sweeps across link lists) incorrectly intercepted as navigation requests.
- **Drag-Away False Navigation Rate**: Percentage of cancelled mouse clicks (pointer pressed on a link and dragged off before release) that falsely initiated page jumps.
- **Premature Lead Event Dispatches**: Number of `Lead` events fired upon initial pointer contact or failed form submissions prior to server HTTP 200 verification.
- **Duplicate Conversion Rate**: Percentage of duplicate ad platform conversion signals caused by bubbling event listeners, double-clicks, or repeated page mounts.
- **Ad Platform Deduplication Match Rate**: Percentage of events where browser pixel `event_id` and first-party server event ID matched identically.

---

## Scientific Distinctions: Receipt vs. Reporting vs. Attributed Conversion

In paid-traffic marketing engineering, the following states must never be conflated:

```
[1. Event Queued]
       │  (browser beacons / keepalive fetch)
       ▼
[2. Server Received]
       │  (collector 200 OK + idempotency deduplication)
       ▼
[3. Platform Processed]
       │  (Meta/TikTok/Google event ingestion & data processing)
       ▼
[4. Attributed Conversion]
       │  (cross-device identity graph matching + attribution window window matching)
       ▼
[5. Campaign Optimization Outcome]
       (ad auction bid adjustment and model learning)
```

1. **Browser Beacon Queuing $\ne$ Server Receipt**: Browser queuing (`sendBeacon()` returning `true`) indicates local buffer acceptance, not transport completion or HTTP 200 receipt.
2. **Platform Receipt $\ne$ Attributed Conversion**: Meta or TikTok receiving a `Lead` event does not mean the platform will attribute it to an ad click; identity matching, attribution windows (e.g., 7-day click / 1-day view), and signal deduplication determine attribution.
3. **Never Manufacture Signals**: Fabricating premature lead signals on `pointerdown` corrupts ad platform bidding models with low-intent noise, artificially inflating campaign CPMs and degrading downstream ROAS.

---

## Reproducible Benchmark Suite

Execute the automated simulation harness in `docs/experiment/run_experiment.ts`:
```bash
bun run docs/experiment/run_experiment.ts
```
The harness runs 1,000 synthetic trials across diverse input modalities:
- Desktop mouse clicks with standard 85–120ms hold intervals
- Mobile touch swipes across link dense regions
- Mouse drag-away gestures (press on link, drag out, release)
- Form submissions with server validation errors
- Successful lead submissions with server confirmation
- Auxiliary and modifier clicks (middle click, Cmd+Click)

---

## Empirical Hypotheses

1. **Hypothesis 1 (Touch Safety)**: FastLink Safe achieves 0.0% touch scroll hijack rate by strictly rejecting `pointerType !== 'mouse'`.
2. **Hypothesis 2 (Signal Truth)**: FastLink Safe generates 0 premature `Lead` events, whereas naive pointerdown systems generate false conversions on drag-away and unconfirmed gestures.
3. **Hypothesis 3 (Latency Reduction)**: FastLink Safe reclaims the 85ms–120ms mouse hold window via Speculation Rules prefetch, warming the destination before click confirmation without risking premature navigation.
