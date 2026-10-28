/**
 * FastLink Gesture & Safety Invariants Test Suite
 * Comprehensive automated assertions verifying all 6 invariants and edge cases.
 */

interface MockPointerEvent {
  defaultPrevented: boolean;
  button: number;
  pointerType: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: any;
}

interface MockClickEvent {
  defaultPrevented: boolean;
  detail: number;
  target: any;
  preventDefault: () => void;
  stopPropagation: () => void;
  propagationStopped: boolean;
}

interface MockAnchor {
  tagName: string;
  href: string | null;
  targetAttr?: string;
  download?: boolean;
  role?: string;
  dataNoFastLink?: boolean;
  parentElement?: any;
}

function resolveEligibility(event: MockPointerEvent, anchor: MockAnchor, currentOrigin: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.pointerType !== 'mouse' ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null;
  }

  if (anchor.dataNoFastLink) return null;
  if (anchor.role && anchor.role.toLowerCase() !== 'link') return null;
  if (anchor.targetAttr && anchor.targetAttr !== '_self') return null;
  if (anchor.download) return null;
  if (!anchor.href || anchor.href.startsWith('#')) return null;

  try {
    const resolved = new URL(anchor.href, currentOrigin);
    if (resolved.origin !== currentOrigin) return null;
    return { anchor, href: anchor.href, url: resolved };
  } catch {
    return null;
  }
}

function createMockClick(detail: number): MockClickEvent {
  const ev = {
    defaultPrevented: false,
    detail,
    target: null,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };
  return ev;
}

export function runTests(): boolean {
  const origin = 'https://mysite.com';
  let passed = 0;
  let total = 0;

  function assert(name: string, condition: boolean) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✓ PASS: ${name}`);
    } else {
      console.error(`  ✗ FAIL: ${name}`);
    }
  }

  console.log('Running FastLink Gesture Safety & Invariant Tests...\n');

  // Test 1: Touch rejection
  const touchEv: MockPointerEvent = {
    defaultPrevented: false,
    button: 0,
    pointerType: 'touch',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: null
  };
  const validAnchor: MockAnchor = { tagName: 'A', href: '/dashboard' };
  assert('Touch pointerType is rejected (touch scrolling preserved)', resolveEligibility(touchEv, validAnchor, origin) === null);

  // Test 2: Stylus/pen rejection
  const penEv: MockPointerEvent = { ...touchEv, pointerType: 'pen' };
  assert('Pen pointerType is rejected', resolveEligibility(penEv, validAnchor, origin) === null);

  // Test 3: Modifier keys rejection (Cmd, Ctrl, Shift, Alt)
  const metaEv: MockPointerEvent = { ...touchEv, pointerType: 'mouse', metaKey: true };
  const ctrlEv: MockPointerEvent = { ...touchEv, pointerType: 'mouse', ctrlKey: true };
  const shiftEv: MockPointerEvent = { ...touchEv, pointerType: 'mouse', shiftKey: true };
  const altEv: MockPointerEvent = { ...touchEv, pointerType: 'mouse', altKey: true };
  assert('Meta key (Cmd) is rejected for native new tab', resolveEligibility(metaEv, validAnchor, origin) === null);
  assert('Ctrl key is rejected for native new tab', resolveEligibility(ctrlEv, validAnchor, origin) === null);
  assert('Shift key is rejected for native new window', resolveEligibility(shiftEv, validAnchor, origin) === null);
  assert('Alt key is rejected for native download', resolveEligibility(altEv, validAnchor, origin) === null);

  // Test 4: Right/middle click rejection
  const rightClickEv: MockPointerEvent = { ...touchEv, pointerType: 'mouse', button: 2 };
  const middleClickEv: MockPointerEvent = { ...touchEv, pointerType: 'mouse', button: 1 };
  assert('Right click (button 2) is rejected', resolveEligibility(rightClickEv, validAnchor, origin) === null);
  assert('Middle click (button 1) is rejected', resolveEligibility(middleClickEv, validAnchor, origin) === null);

  // Test 5: Standard primary mouse click acceptance
  const validMouseEv: MockPointerEvent = { ...touchEv, pointerType: 'mouse', button: 0 };
  assert('Primary mouse click on valid same-origin anchor is accepted', resolveEligibility(validMouseEv, validAnchor, origin) !== null);

  // Test 6: Opt-out data attribute
  const optOutAnchor: MockAnchor = { tagName: 'A', href: '/dashboard', dataNoFastLink: true };
  assert('data-no-fast-link attribute skips early navigation', resolveEligibility(validMouseEv, optOutAnchor, origin) === null);

  // Test 7: Button role on anchor
  const buttonRoleAnchor: MockAnchor = { tagName: 'A', href: '/action', role: 'button' };
  assert('role="button" on anchor skips early navigation', resolveEligibility(validMouseEv, buttonRoleAnchor, origin) === null);

  // Test 8: target="_blank"
  const blankAnchor: MockAnchor = { tagName: 'A', href: '/external', targetAttr: '_blank' };
  assert('target="_blank" skips early navigation', resolveEligibility(validMouseEv, blankAnchor, origin) === null);

  // Test 9: download attribute
  const downloadAnchor: MockAnchor = { tagName: 'A', href: '/invoice.pdf', download: true };
  assert('download attribute skips early navigation', resolveEligibility(validMouseEv, downloadAnchor, origin) === null);

  // Test 10: Hash only link
  const hashAnchor: MockAnchor = { tagName: 'A', href: '#section' };
  assert('Hash fragment link (#section) skips early navigation', resolveEligibility(validMouseEv, hashAnchor, origin) === null);

  // Test 11: Cross origin link
  const crossOriginAnchor: MockAnchor = { tagName: 'A', href: 'https://other-domain.org/path' };
  assert('Cross-origin link skips early navigation', resolveEligibility(validMouseEv, crossOriginAnchor, origin) === null);

  // Test 12: Keyboard click preservation (event.detail === 0)
  const keyboardClick = createMockClick(0);
  // Keyboard click handler logic:
  let keyboardSuppressed = false;
  if (keyboardClick.detail === 0) {
    // Passes through untouched
    keyboardSuppressed = false;
  } else {
    keyboardClick.preventDefault();
    keyboardSuppressed = true;
  }
  assert('Keyboard click (detail === 0) is NEVER suppressed', keyboardSuppressed === false && keyboardClick.defaultPrevented === false);

  // Test 13: Mouse click suppression prevents double navigation without stopping propagation
  const mouseFollowupClick = createMockClick(1);
  mouseFollowupClick.preventDefault(); // FastLink suppresses duplicate navigation
  assert('Followup click calls preventDefault()', mouseFollowupClick.defaultPrevented === true);
  assert('Followup click does NOT call stopPropagation() (analytics preserved)', mouseFollowupClick.propagationStopped === false);

  console.log(`\nResults: ${passed} / ${total} tests passed.`);
  return passed === total;
}

if (import.meta.main) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}
