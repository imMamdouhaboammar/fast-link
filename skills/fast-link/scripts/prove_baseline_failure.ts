/**
 * Baseline Failure Demonstration for FastLink Navigation
 * Proves the exact failure modes of naive agent-generated pointerdown navigation
 * vs. FastLink's deterministic eligibility resolver and coordination engine.
 */

interface SimulatedPointerEvent {
  type: string;
  pointerType: 'mouse' | 'touch' | 'pen';
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: {
    tagName: string;
    href?: string;
    targetAttr?: string;
    download?: boolean;
    role?: string;
    dataNoFastLink?: boolean;
    closest?: (selector: string) => any;
    parentElement?: any;
  };
}

// 1. Naive implementation commonly written by LLMs without the fast-link skill
function naiveAgentNavigator(event: SimulatedPointerEvent): { navigated: boolean; failureClass?: string } {
  const target = event.target;
  // Naive agent checks for href and navigates on any pointerdown
  if (target.href) {
    if (event.pointerType === 'touch') {
      return { navigated: true, failureClass: 'TOUCH_SCROLL_HIJACK' };
    }
    if (event.metaKey || event.ctrlKey || event.button !== 0) {
      return { navigated: true, failureClass: 'MODIFIER_OR_AUX_CLICK_CORRUPTION' };
    }
    if (target.download) {
      return { navigated: true, failureClass: 'FILE_DOWNLOAD_HIJACK' };
    }
    if (target.targetAttr === '_blank') {
      return { navigated: true, failureClass: 'TARGET_BLANK_HIJACK' };
    }
    return { navigated: true };
  }
  return { navigated: false };
}

// 2. FastLink Production Invariant Resolver
function fastLinkEligibilityResolver(event: SimulatedPointerEvent, currentOrigin: string): { eligible: boolean; rejectionReason?: string } {
  // Invariant 1: Reject defaultPrevented
  if (event.defaultPrevented) return { eligible: false, rejectionReason: 'DEFAULT_PREVENTED' };

  // Invariant 2: Left button only
  if (event.button !== 0) return { eligible: false, rejectionReason: 'NOT_PRIMARY_BUTTON' };

  // Invariant 3: Mouse only (protects touch scroll and stylus gestures)
  if (event.pointerType !== 'mouse') return { eligible: false, rejectionReason: 'NON_MOUSE_POINTER' };

  // Invariant 4: Passthrough modifiers
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return { eligible: false, rejectionReason: 'MODIFIER_ACTIVE' };
  }

  const anchor = event.target;
  if (!anchor || !anchor.href) return { eligible: false, rejectionReason: 'NO_HREF' };

  // Invariant 5: Opt-out data attribute
  if (anchor.dataNoFastLink) return { eligible: false, rejectionReason: 'OPT_OUT_ATTRIBUTE' };

  // Invariant 6: Role !== link
  if (anchor.role && anchor.role.toLowerCase() !== 'link') {
    return { eligible: false, rejectionReason: 'NON_LINK_ROLE' };
  }

  // Invariant 7: Target !== _self
  if (anchor.targetAttr && anchor.targetAttr !== '_self') {
    return { eligible: false, rejectionReason: 'NON_SELF_TARGET' };
  }

  // Invariant 8: Downloads pass through native
  if (anchor.download) return { eligible: false, rejectionReason: 'DOWNLOAD_ATTRIBUTE' };

  // Invariant 9: Hash links pass through native
  if (anchor.href.startsWith('#')) return { eligible: false, rejectionReason: 'HASH_FRAGMENT_ONLY' };

  // Invariant 10: Same-origin verification
  try {
    const parsed = new URL(anchor.href, currentOrigin);
    if (parsed.origin !== currentOrigin) {
      return { eligible: false, rejectionReason: 'CROSS_ORIGIN' };
    }
  } catch {
    return { eligible: false, rejectionReason: 'MALFORMED_URL' };
  }

  return { eligible: true };
}

// Run comparison suite
export function runBaselineFailureSuite() {
  const currentOrigin = 'https://example.com';
  const testScenarios: { name: string; event: SimulatedPointerEvent; shouldBeEligible: boolean }[] = [
    {
      name: 'Mobile Touch Inertia Scroll',
      event: {
        type: 'pointerdown',
        pointerType: 'touch',
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        target: { tagName: 'A', href: 'https://example.com/products' }
      },
      shouldBeEligible: false
    },
    {
      name: 'Cmd+Click (Open in New Tab)',
      event: {
        type: 'pointerdown',
        pointerType: 'mouse',
        button: 0,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        target: { tagName: 'A', href: 'https://example.com/products' }
      },
      shouldBeEligible: false
    },
    {
      name: 'Middle Click (Auxiliary Wheel Button)',
      event: {
        type: 'pointerdown',
        pointerType: 'mouse',
        button: 1,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        target: { tagName: 'A', href: 'https://example.com/products' }
      },
      shouldBeEligible: false
    },
    {
      name: 'Download Link (report.pdf)',
      event: {
        type: 'pointerdown',
        pointerType: 'mouse',
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        target: { tagName: 'A', href: 'https://example.com/report.pdf', download: true }
      },
      shouldBeEligible: false
    },
    {
      name: 'Cross-Origin Link (external doc)',
      event: {
        type: 'pointerdown',
        pointerType: 'mouse',
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        target: { tagName: 'A', href: 'https://external-service.org/docs' }
      },
      shouldBeEligible: false
    },
    {
      name: 'Legitimate Same-Origin Primary Mouse Click',
      event: {
        type: 'pointerdown',
        pointerType: 'mouse',
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        target: { tagName: 'A', href: 'https://example.com/docs/getting-started' }
      },
      shouldBeEligible: true
    }
  ];

  console.log('===============================================================');
  console.log('FASTLINK BASELINE FAILURE VS. INVARIANT ENFORCEMENT AUDIT');
  console.log('===============================================================\n');

  let naiveFailures = 0;
  let fastLinkSuccesses = 0;

  for (const s of testScenarios) {
    const naiveRes = naiveAgentNavigator(s.event);
    const fastLinkRes = fastLinkEligibilityResolver(s.event, currentOrigin);

    const naiveFailed = s.shouldBeEligible ? !naiveRes.navigated : naiveRes.navigated;
    const fastLinkCorrect = fastLinkRes.eligible === s.shouldBeEligible;

    if (naiveFailed) naiveFailures++;
    if (fastLinkCorrect) fastLinkSuccesses++;

    console.log(`Scenario: ${s.name}`);
    console.log(`  Target Expectation : ${s.shouldBeEligible ? 'ELIGIBLE' : 'REJECT (Preserve Native)'}`);
    console.log(`  Naive Agent Output : ${naiveRes.navigated ? 'NAVIGATED' : 'IGNORED'} ${naiveRes.failureClass ? `[CRITICAL FAILURE: ${naiveRes.failureClass}]` : ''}`);
    console.log(`  FastLink Output    : ${fastLinkRes.eligible ? 'ELIGIBLE' : `REJECTED (${fastLinkRes.rejectionReason})`}`);
    console.log(`  Outcome            : ${fastLinkCorrect ? '✓ FASTLINK INVARIANT PRESERVED' : '✗ FAILED'}\n`);
  }

  console.log('---------------------------------------------------------------');
  console.log(`Audit Summary:`);
  console.log(`  Naive Implementation Failure Count : ${naiveFailures} / ${testScenarios.length} scenarios corrupted`);
  console.log(`  FastLink Invariant Success Count    : ${fastLinkSuccesses} / ${testScenarios.length} scenarios verified`);
  console.log('===============================================================\n');

  if (fastLinkSuccesses !== testScenarios.length) {
    process.exit(1);
  }
}

if (import.meta.main) {
  runBaselineFailureSuite();
}
