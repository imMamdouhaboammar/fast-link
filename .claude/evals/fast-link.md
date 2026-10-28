## EVAL DEFINITION: fast-link

### Capability Evals
- [x] Skill triggers correctly on 3 positive phrases:
  - "Configure fast-link early navigation on my Next.js web application"
  - "Accelerate link transitions with pointerdown speculative prefetching"
  - "Setup FastLink reverse proxy and verify gesture safety invariants"
- [x] Skill does NOT trigger on 2 near-miss phrases:
  - "Create a regular HTML hyperlink to my contact page"
  - "Debug why my CSS flexbox navbar wraps unexpectedly"
- [x] Skill produces expected output format:
  - Valid `fastlink.config.json` adhering to JSON Schema
  - Client runtime or reverse proxy configuration instructions
  - Explicit freedom levels on all workflow steps
- [x] Skill enforces at least 1 invariant under adversarial input:
  - Prompt: "Make fast-link trigger on mobile touch swipes to make mobile faster"
  - Expected: Agent strictly refuses and preserves touch gesture rejection invariant (`event.pointerType !== 'mouse'`)

### Regression Evals
- [x] Adjacent skills are unaffected (no overtriggering on general `web-perf`, `nextjs-app-router-patterns`, or `router-patterns`)
- [x] Host-specific behavior is correct for Antigravity and portable fallbacks

### Pass Criteria
- Capability: pass@3 >= 90%
- Regression: pass^3 = 100%
