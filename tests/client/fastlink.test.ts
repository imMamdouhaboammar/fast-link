/**
 * FastLink Client Runtime Test Suite
 * Comprehensive verification of Universal Browser Core (Module A)
 * and Measurement & Signal Layer (Module B).
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { FastLink, FastLinkCore, FastLinkRuntime, FastLinkSignals } from '../../client/src/index';

// Polyfill minimal DOM environment for testing in Bun if needed
function setupMockDom() {
  const elements = new Map<string, any>();

  class MockElement {
    tagName: string;
    attributes: Map<string, string>;
    parentElement: MockElement | null = null;
    children: MockElement[] = [];

    constructor(tagName: string) {
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map();
    }

    setAttribute(name: string, val: string) {
      this.attributes.set(name, String(val));
    }

    getAttribute(name: string): string | null {
      return this.attributes.has(name) ? this.attributes.get(name)! : null;
    }

    hasAttribute(name: string): boolean {
      return this.attributes.has(name);
    }

    removeAttribute(name: string) {
      this.attributes.delete(name);
    }

    contains(node: any): boolean {
      if (node === this) return true;
      let cur = node;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    appendChild(child: MockElement) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
  }

  const listeners: Record<string, Function[]> = {};

  const mockDocument: any = {
    baseURI: 'https://example.com/landing',
    body: new MockElement('BODY'),
    head: new MockElement('HEAD'),
    createElement(tagName: string) {
      return new MockElement(tagName);
    },
    addEventListener(event: string, fn: Function) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener(event: string, fn: Function) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    },
    _listeners: listeners,
  };

  const mockWindow: any = {
    location: {
      origin: 'https://example.com',
      pathname: '/landing',
      href: 'https://example.com/landing?utm_source=meta&token=secret123',
      assign: (url: string) => {},
    },
    document: mockDocument,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as any).window = mockWindow;
  (globalThis as any).document = mockDocument;
  (globalThis as any).Element = MockElement;
  (globalThis as any).HTMLAnchorElement = MockElement;
  (globalThis as any).HTMLFormElement = MockElement;
  (globalThis as any).HTMLScriptElement = {
    supports: (val: string) => val === 'speculationrules',
  };
  (globalThis as any).navigator = {
    sendBeacon: (url: string, data: any) => true,
    connection: { saveData: false, effectiveType: '4g' },
  };

  return { mockWindow, mockDocument, MockElement };
}

describe('FastLink Core & Invariant Verification', () => {
  beforeEach(() => {
    FastLink.destroy();
    setupMockDom();
  });

  it('rejects touch pointerType to preserve mobile touch scrolling', () => {
    const runtime = new FastLinkRuntime({ mode: 'safe' });
    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/products');

    const touchEvent: any = {
      defaultPrevented: false,
      button: 0,
      pointerType: 'touch',
      target: anchor,
    };

    const intent = runtime.core.resolveEligibility(touchEvent, anchor);
    expect(intent).toBeNull();
  });

  it('rejects pen pointerType', () => {
    const runtime = new FastLinkRuntime({ mode: 'safe' });
    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/products');

    const penEvent: any = {
      defaultPrevented: false,
      button: 0,
      pointerType: 'pen',
      target: anchor,
    };

    const intent = runtime.core.resolveEligibility(penEvent, anchor);
    expect(intent).toBeNull();
  });

  it('rejects non-primary mouse buttons (middle and right click)', () => {
    const runtime = new FastLinkRuntime({ mode: 'safe' });
    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/products');

    // Middle click (button 1)
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 1, pointerType: 'mouse' } as any, anchor)).toBeNull();

    // Right click (button 2)
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 2, pointerType: 'mouse' } as any, anchor)).toBeNull();
  });

  it('rejects modifier keys to preserve native new tab and new window', () => {
    const runtime = new FastLinkRuntime({ mode: 'safe' });
    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/products');

    // Meta (Cmd)
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse', metaKey: true } as any, anchor)).toBeNull();
    // Ctrl
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse', ctrlKey: true } as any, anchor)).toBeNull();
    // Shift
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse', shiftKey: true } as any, anchor)).toBeNull();
    // Alt
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse', altKey: true } as any, anchor)).toBeNull();
  });

  it('rejects download links, target=_blank, and hash-only links', () => {
    const runtime = new FastLinkRuntime({ mode: 'safe' });

    // Download attribute
    const downloadAnchor = document.createElement('a') as any;
    downloadAnchor.setAttribute('href', '/file.pdf');
    downloadAnchor.setAttribute('download', '');
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse' } as any, downloadAnchor)).toBeNull();

    // Target _blank
    const blankAnchor = document.createElement('a') as any;
    blankAnchor.setAttribute('href', '/terms');
    blankAnchor.setAttribute('target', '_blank');
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse' } as any, blankAnchor)).toBeNull();

    // Hash only link
    const hashAnchor = document.createElement('a') as any;
    hashAnchor.setAttribute('href', '#section-faq');
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse' } as any, hashAnchor)).toBeNull();
  });

  it('rejects clicks originating within nested interactive elements', () => {
    const runtime = new FastLinkRuntime({ mode: 'safe' });
    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/profile');

    const button = document.createElement('button') as any;
    anchor.appendChild(button);

    expect(runtime.core.isOptedOut(button, anchor)).toBe(true);
  });

  it('respects route exclusions', () => {
    const runtime = new FastLinkRuntime({
      mode: 'safe',
      navigation: {
        exclude: ['/logout', '/admin/*', '/api/*'],
      },
    });

    const logoutAnchor = document.createElement('a') as any;
    logoutAnchor.setAttribute('href', '/logout');
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse' } as any, logoutAnchor)).toBeNull();

    const adminAnchor = document.createElement('a') as any;
    adminAnchor.setAttribute('href', '/admin/settings');
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse' } as any, adminAnchor)).toBeNull();
  });

  it('honors matchDataFastLinkOnly when enabled', () => {
    const runtime = new FastLinkRuntime({
      mode: 'safe',
      navigation: { matchDataFastLinkOnly: true },
    });

    const unannotatedAnchor = document.createElement('a') as any;
    unannotatedAnchor.setAttribute('href', '/catalog');
    expect(runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse' } as any, unannotatedAnchor)).toBeNull();

    const annotatedAnchor = document.createElement('a') as any;
    annotatedAnchor.setAttribute('href', '/catalog');
    annotatedAnchor.setAttribute('data-fast-link', 'true');
    const intent = runtime.core.resolveEligibility({ defaultPrevented: false, button: 0, pointerType: 'mouse' } as any, annotatedAnchor);
    expect(intent).not.toBeNull();
  });

  it('safe mode prefetches on pointer intent but NEVER navigates on pointerdown', () => {
    let assignedUrl: string | null = null;
    (window as any).location.assign = (url: string) => {
      assignedUrl = url;
    };

    const runtime = new FastLinkRuntime({ mode: 'safe' });
    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/checkout');
    document.body.appendChild(anchor);

    // Trigger pointerdown
    const pointerDownListeners = (document as any)._listeners['pointerdown'];
    expect(pointerDownListeners).toBeDefined();

    pointerDownListeners[0]({
      defaultPrevented: false,
      button: 0,
      pointerType: 'mouse',
      target: anchor,
    });

    // In SAFE mode, window.location.assign must NOT be called on pointerdown!
    expect(assignedUrl).toBeNull();

    // But prefetch should have been executed via Speculation Rules
    expect(runtime.core.getPrefetchedUrls()).toContain('https://example.com/checkout');
  });

  it('fast mode navigates early on pointerdown ONLY for approved routes', () => {
    let assignedUrl: string | null = null;
    (window as any).location.assign = (url: string) => {
      assignedUrl = url;
    };

    const runtime = new FastLinkRuntime({
      mode: 'fast',
      navigation: {
        fastRoutes: ['/approved-page'],
      },
    });

    const approvedAnchor = document.createElement('a') as any;
    approvedAnchor.setAttribute('href', '/approved-page');
    document.body.appendChild(approvedAnchor);

    const pointerDownListeners = (document as any)._listeners['pointerdown'];
    pointerDownListeners[0]({
      defaultPrevented: false,
      button: 0,
      pointerType: 'mouse',
      target: approvedAnchor,
    });

    // In FAST mode on an approved route, early navigation should occur
    expect(assignedUrl).toBe('https://example.com/approved-page');
  });

  it('observe mode does not prefetch and does not modify navigation', () => {
    let assignedUrl: string | null = null;
    (window as any).location.assign = (url: string) => {
      assignedUrl = url;
    };

    const runtime = new FastLinkRuntime({ mode: 'observe' });
    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/about');
    document.body.appendChild(anchor);

    const pointerDownListeners = (document as any)._listeners['pointerdown'];
    pointerDownListeners[0]({
      defaultPrevented: false,
      button: 0,
      pointerType: 'mouse',
      target: anchor,
    });

    // Observe mode must NOT navigate
    expect(assignedUrl).toBeNull();
    // Observe mode must NOT prefetch
    expect(runtime.core.getPrefetchedUrls().length).toBe(0);
  });

  it('detects mouse drag-away and marks interaction as aborted', () => {
    let emittedTelemetry: any = null;
    const runtime = new FastLinkRuntime(
      { mode: 'safe' },
    );
    (runtime as any).core.onTelemetryCallback = (data: any) => {
      emittedTelemetry = data;
    };

    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/contact');
    document.body.appendChild(anchor);

    const outsideDiv = document.createElement('div') as any;
    document.body.appendChild(outsideDiv);

    const pointerDownListeners = (document as any)._listeners['pointerdown'];
    const pointerUpListeners = (document as any)._listeners['pointerup'];

    // Press down on anchor
    pointerDownListeners[0]({
      defaultPrevented: false,
      button: 0,
      pointerType: 'mouse',
      target: anchor,
    });

    // Drag away and release outside anchor
    pointerUpListeners[0]({
      target: outsideDiv,
    });

    expect(emittedTelemetry).not.toBeNull();
    expect(emittedTelemetry.was_aborted).toBe(true);
    expect(emittedTelemetry.click_suppressed).toBe(false);
  });
});

describe('FastLink Measurement & Signal Layer', () => {
  beforeEach(() => {
    FastLink.destroy();
    setupMockDom();
  });

  it('pointerdown NEVER dispatches a marketing or conversion event', () => {
    let pixelCalled = false;
    (window as any).fbq = () => {
      pixelCalled = true;
    };

    FastLink.init({
      mode: 'safe',
      signals: {
        consent: () => true,
        providers: { meta: true },
      },
    });

    const anchor = document.createElement('a') as any;
    anchor.setAttribute('href', '/lead');
    anchor.setAttribute('data-fl-event', 'Lead');
    document.body.appendChild(anchor);

    const pointerDownListeners = (document as any)._listeners['pointerdown'];
    pointerDownListeners[0]({
      defaultPrevented: false,
      button: 0,
      pointerType: 'mouse',
      target: anchor,
    });

    // Invariant 1: Pointerdown must NEVER trigger conversion events!
    expect(pixelCalled).toBe(false);
  });

  it('confirmed click on CTA element dispatches configured event with stable event_id', () => {
    const metaEvents: any[] = [];
    const tiktokEvents: any[] = [];
    (window as any).fbq = (action: string, name: string, params: any, extra: any) => {
      metaEvents.push({ action, name, params, extra });
    };
    (window as any).ttq = {
      track: (name: string, params: any, extra: any) => {
        tiktokEvents.push({ name, params, extra });
      },
    };

    FastLink.init({
      mode: 'safe',
      signals: {
        consent: () => true,
        providers: { meta: true, tiktok: true },
      },
    });

    const ctaLink = document.createElement('a') as any;
    ctaLink.setAttribute('href', 'https://wa.me/1234567890');
    ctaLink.setAttribute('data-fl-event', 'Contact');
    ctaLink.setAttribute('data-fl-cta', 'whatsapp');
    document.body.appendChild(ctaLink);

    // Simulate click event
    const clickListeners = (document as any)._listeners['click'];
    for (const listener of clickListeners) {
      listener({ target: ctaLink, detail: 1 });
    }

    expect(metaEvents.length).toBe(1);
    expect(metaEvents[0].name).toBe('Contact');
    expect(tiktokEvents.length).toBe(1);
    expect(tiktokEvents[0].name).toBe('Contact');

    // Verify stable eventID match between Meta and TikTok
    const metaEventId = metaEvents[0].extra.eventID;
    const tiktokEventId = tiktokEvents[0].extra.event_id;
    expect(metaEventId).toBeDefined();
    expect(metaEventId).toBe(tiktokEventId);
  });

  it('withholds marketing signals when consent is denied or unknown', () => {
    let metaCalled = false;
    let tiktokCalled = false;
    (window as any).fbq = () => {
      metaCalled = true;
    };
    (window as any).ttq = {
      track: () => {
        tiktokCalled = true;
      },
    };

    FastLink.init({
      mode: 'safe',
      signals: {
        consent: () => false, // Consent denied
        providers: { meta: true, tiktok: true },
      },
    });

    FastLink.recordEvent('Contact', { test: true });

    expect(metaCalled).toBe(false);
    expect(tiktokCalled).toBe(false);
  });

  it('form submit gesture emits FormAttempt, NEVER verified Lead', () => {
    const metaEvents: any[] = [];
    (window as any).fbq = (action: string, name: string, params: any, extra: any) => {
      metaEvents.push({ name, extra });
    };

    FastLink.init({
      mode: 'safe',
      signals: {
        consent: () => true,
        providers: { meta: true },
      },
    });

    const form = document.createElement('form') as any;
    form.setAttribute('data-fl-form', 'lead-gen');
    form.id = 'hero-lead-form';
    document.body.appendChild(form);

    const submitListeners = (document as any)._listeners['submit'];
    submitListeners[0]({ target: form });

    // Must be FormAttempt, not Lead!
    expect(metaEvents.length).toBe(1);
    expect(metaEvents[0].name).toBe('FormAttempt');
    expect(metaEvents[0].name).not.toBe('Lead');
  });

  it('recordVerifiedLead emits verified Lead event upon server confirmation', () => {
    const metaEvents: any[] = [];
    (window as any).fbq = (action: string, name: string, params: any, extra: any) => {
      metaEvents.push({ name, extra });
    };

    FastLink.init({
      mode: 'safe',
      signals: {
        consent: () => true,
        providers: { meta: true },
      },
    });

    const leadEventId = FastLink.recordVerifiedLead({ email_domain: 'example.com' });

    expect(metaEvents.length).toBe(1);
    expect(metaEvents[0].name).toBe('Lead');
    expect(metaEvents[0].extra.eventID).toBe(leadEventId);
  });

  it('sanitizes sensitive query parameters from tracked URLs', () => {
    const signals = new FastLinkSignals({
      signals: { stripSensitiveParams: true },
    });

    const dirtyUrl = 'https://mysite.com/checkout?token=xyz123&password=secret&utm_source=ad&auth=abc';
    const cleanUrl = signals.sanitizeUrl(dirtyUrl);

    expect(cleanUrl).not.toContain('xyz123');
    expect(cleanUrl).not.toContain('secret');
    expect(cleanUrl).not.toContain('token=');
    expect(cleanUrl).not.toContain('password=');
    expect(cleanUrl).toContain('utm_source=ad');
  });

  it('deduplicates event dispatch for the same event ID', () => {
    let callCount = 0;
    (window as any).fbq = () => {
      callCount++;
    };

    FastLink.init({
      mode: 'safe',
      signals: {
        consent: () => true,
        providers: { meta: true },
      },
    });

    const stableId = 'evt_test_fixed_123';
    FastLink.recordEvent('CustomCTA', {}, { eventId: stableId });
    FastLink.recordEvent('CustomCTA', {}, { eventId: stableId }); // duplicate attempt

    expect(callCount).toBe(1);
  });
});
