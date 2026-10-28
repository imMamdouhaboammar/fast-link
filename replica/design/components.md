# Component Specifications: FastLink

Component specifications for FastLink UI surfaces, telemetry dashboard, and live debug overlay.

## 1. FastLink Anchor (`<a>` element)
- **Variants**: Standard text link, Card link, Navigation tab.
- **States**:
  - `default`: Normal text styling (`text-accent` or inherit).
  - `hover`: Mouse over, background/underline transition (`motion-instant`).
  - `pressed` (`pointerdown`): Immediate visual feedback on press. FastLink triggers early navigation at this exact millisecond.
  - `navigating`: Route transition in progress; optional subtle top loading bar or aria-busy state.
  - `disabled`: Anchor with `data-no-fast-link` or `enabled=false` falls back to ordinary click navigation.
- **Tokens**: `color.accent`, `color.on-accent`, `motion.fast` (85ms).
- **Accessibility**: Standard `<a href="...">` semantics preserved; screen readers announce link role; keyboard navigation (Enter key) emits click with `detail === 0` which is never suppressed.

## 2. FastLink Region Container (`<div data-fast-link-region>`)
- **Variants**: Default (`display: contents`), Nav block, Content list.
- **States**:
  - `active`: Intercepts pointerdown on all contained same-origin links at capture phase.
  - `nested`: If child link has its own controller, child takes precedence over region.
- **Tokens**: Inherits layout, zero DOM visual footprint.

## 3. Telemetry Metric Card
- **Variants**: Single stat (e.g. "Median Hold Time: 84ms"), Dual stat ("Recovered Latency: +85ms"), Gauge ("Click Suppression: 99.8%").
- **States**:
  - `default`: Surface background with border.
  - `updating`: Live pulse when new telemetry batches arrive.
- **Tokens**: `color.surface`, `color.border`, `color.text`, `type.xl`, `shadow.card`.

## 4. Live Debug Overlay (Developer Mode)
- **Variants**: Floating bottom-right badge, expanded drawer.
- **States**:
  - `minimized`: Compact pill showing "FastLink Active · Last hold: 82ms".
  - `expanded`: Timeline showing exact millisecond intervals:
    `[0ms pointerdown] -> [0.8ms prefetch sent] -> [84ms pointerup] -> [85ms click suppressed]`.
- **Tokens**: `color.surface`, `color.text`, `color.success`, `font.mono`, `radius.md`.
