# Durable Failure Lessons Index

| Topic / Skill | Primary Invariants Enforced | Lesson Link | Status |
|---|---|---|---|
| **fast-link** | Touch rejection, modifier passthrough, non-destructive click suppression (`preventDefault` only), keyboard accessibility | [fast-link.md](fast-link.md) | Verified |

## Rules We Now Enforce
- [Every pointerdown navigation listener must enforce `event.pointerType === 'mouse'` to preserve mobile touch scrolling inertia.]
- [Modifier keys (`Cmd`, `Ctrl`, `Shift`, `Alt`) and non-primary buttons (`button !== 0`) must bypass early navigation to preserve native new-tab, new-window, and context menu behaviors.]
- [Follow-up synthetic clicks must be neutralized using `event.preventDefault()` only; `event.stopPropagation()` is strictly prohibited.]
- [Keyboard activation events (`event.detail === 0`) must never be suppressed.]
- [Speculative prefetching must strictly enforce same-origin verification and exclude mutation, auth, or logout routes.]
