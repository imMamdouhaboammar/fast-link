/**
 * Module A — Universal Browser Core
 * Framework-independent interaction and navigation engine.
 * Supports 'observe', 'safe', and 'fast' navigation modes.
 */

import { FastLinkConfig, FastLinkIntent, FastLinkMode } from './types';

const HANDLED_EVENTS = new WeakSet<Event>();
const SUPPRESSED_CLICKS = new WeakSet<Event>();
const NESTED_TAGS: Record<string, number> = {
  BUTTON: 1,
  INPUT: 1,
  LABEL: 1,
  SELECT: 1,
  SUMMARY: 1,
  TEXTAREA: 1,
};
const BUTTON_ROLE_REGEX = /(?:^|[\t\n\f\r ])button(?:$|[\t\n\f\r ])/i;
const LINK_ROLE_REGEX = /^[\t\n\f\r ]*(?:link)?[\t\n\f\r ]*$/i;
const DEFAULT_EXCLUSIONS = ['/api/*', '/auth/*', '/logout', '/admin/*'];
const MUTATING_QUERY_KEYS = new Set([
  'add-to-cart', 'wc-ajax', 'action', 'logout', '_wpnonce', 'remove_item',
]);

export class FastLinkCore {
  private config: FastLinkConfig;
  private pendingAnchor: HTMLAnchorElement | null = null;
  private pendingFastAnchor: HTMLAnchorElement | null = null;
  private pressTimestamp = 0;
  private prefetchedUrls = new Set<string>();
  private activePendingIntent: FastLinkIntent | null = null;
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundClick: (e: MouseEvent) => void;
  private onTelemetryCallback?: (data: any) => void;
  private isDestroyed = false;

  constructor(config: FastLinkConfig = {}, onTelemetry?: (data: any) => void) {
    this.config = {
      mode: config.mode || 'safe',
      navigation: {
        prefetch: config.navigation?.prefetch || 'same-origin',
        preserveNativeClicks: config.navigation?.preserveNativeClicks !== false,
        exclude: config.navigation?.exclude || DEFAULT_EXCLUSIONS,
        fastRoutes: config.navigation?.fastRoutes || [],
        matchDataFastLinkOnly: config.navigation?.matchDataFastLinkOnly || false,
        timeoutMs: config.navigation?.timeoutMs || 5000,
      },
      signals: config.signals || {},
      debug: !!config.debug,
    };
    this.onTelemetryCallback = onTelemetry;

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundClick = this.handleClick.bind(this);

    this.attachListeners();
  }

  public getMode(): FastLinkMode {
    return this.config.mode || 'safe';
  }

  public setMode(mode: FastLinkMode): void {
    this.config.mode = mode;
  }

  public getPrefetchedUrls(): string[] {
    return Array.from(this.prefetchedUrls);
  }

  public findAnchor(target: EventTarget | null, boundary: Element | null = document.body): HTMLAnchorElement | null {
    let el = target instanceof Element ? target : (target && (target as any).parentElement ? (target as any).parentElement : null);
    while (el && el !== boundary) {
      if (el.tagName === 'A' && el.hasAttribute('href')) {
        return el as HTMLAnchorElement;
      }
      el = el.parentElement;
    }
    return el && el.tagName === 'A' && el.hasAttribute('href') ? (el as HTMLAnchorElement) : null;
  }

  public isOptedOut(target: EventTarget | null, anchor: HTMLAnchorElement): boolean {
    if (anchor.hasAttribute('data-no-fast-link')) return true;
    const role = anchor.getAttribute('role');
    if (role && !LINK_ROLE_REGEX.test(role)) return true;

    let el = target instanceof Element ? target : null;
    while (el && el !== anchor) {
      if (el.hasAttribute('data-no-fast-link')) return true;
      if (NESTED_TAGS[el.tagName]) return true;
      const elRole = el.getAttribute('role');
      if (elRole && BUTTON_ROLE_REGEX.test(elRole)) return true;
      el = el.parentElement;
    }
    return false;
  }

  public isExcluded(pathname: string, search = ''): boolean {
    const params = new URLSearchParams(search);
    for (const key of params.keys()) {
      if (MUTATING_QUERY_KEYS.has(key.toLowerCase())) return true;
    }

    // Configured exclusions add to the mandatory sensitive-route defaults.
    const exclusions = [...DEFAULT_EXCLUSIONS, ...(this.config.navigation?.exclude || [])];
    for (const pattern of exclusions) {
      const target = pattern.includes('?') ? pathname + search : pathname;
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (target.startsWith(prefix)) return true;
      } else if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (target.startsWith(prefix)) return true;
      } else if (target === pattern) {
        return true;
      }
    }
    return false;
  }

  public isFastApproved(pathname: string, anchor: HTMLAnchorElement): boolean {
    if (anchor.getAttribute('data-fl-fast') === 'true') return true;
    const approved = this.config.navigation?.fastRoutes || [];
    for (const pattern of approved) {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (pathname.startsWith(prefix)) return true;
      } else if (pathname === pattern) {
        return true;
      }
    }
    return false;
  }

  public resolveEligibility(event: PointerEvent | null, anchor: HTMLAnchorElement): FastLinkIntent | null {
    if (event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.pointerType !== 'mouse' ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        HANDLED_EVENTS.has(event)
      ) {
        return null;
      }
    }

    if (this.isOptedOut(event ? event.target : null, anchor)) return null;

    if (this.config.navigation?.matchDataFastLinkOnly && !anchor.hasAttribute('data-fast-link')) {
      return null;
    }

    const targetAttr = anchor.getAttribute('target');
    if (targetAttr && targetAttr !== '_self') return null;
    if (anchor.hasAttribute('download')) return null;

    const href = anchor.getAttribute('href');
    if (!href || href.charAt(0) === '#') return null;

    try {
      const baseUri = document.baseURI || window.location.href;
      const resolved = new URL(href, baseUri);

      // Same-origin verification
      if (resolved.origin !== window.location.origin) return null;

      // Exclusions check
      if (this.isExcluded(resolved.pathname, resolved.search)) return null;

      return {
        anchor,
        href,
        url: resolved,
        mode: this.config.mode || 'safe',
        prefetched: this.prefetchedUrls.has(resolved.href),
      };
    } catch {
      return null;
    }
  }

  public prefetchUrl(url: URL): { prefetched: boolean; method: FastLinkIntent['prefetchMethod'] } {
    if (this.getMode() === 'observe' ||
        url.origin !== window.location.origin ||
        this.isExcluded(url.pathname, url.search)) {
      return { prefetched: false, method: 'none' };
    }
    if (this.prefetchedUrls.has(url.href)) {
      return { prefetched: true, method: 'none' };
    }

    // Bandwidth preservation check (Data-Saver / 2G)
    const conn = (navigator as any).connection;
    if (conn && (conn.saveData || conn.effectiveType === '2g')) {
      if (this.config.debug) console.warn('[FastLink] Prefetch skipped due to Save-Data or slow connection.');
      return { prefetched: false, method: 'none' };
    }

    if (this.config.navigation?.prefetch === 'none') {
      return { prefetched: false, method: 'none' };
    }

    let method: FastLinkIntent['prefetchMethod'] = 'none';

    // 1. Try Speculation Rules API
    const hasSpeculationRules = typeof HTMLScriptElement !== 'undefined' &&
      typeof (HTMLScriptElement as any).supports === 'function' &&
      (HTMLScriptElement as any).supports('speculationrules');

    if (hasSpeculationRules) {
      try {
        const specScript = document.createElement('script');
        specScript.type = 'speculationrules';
        specScript.textContent = JSON.stringify({
          prefetch: [
            {
              source: 'list',
              urls: [url.href],
            },
          ],
        });
        document.head.appendChild(specScript);
        this.prefetchedUrls.add(url.href);
        method = 'speculationrules';
        return { prefetched: true, method };
      } catch (e) {
        if (this.config.debug) console.warn('[FastLink] SpeculationRules error:', e);
      }
    }

    // 2. Safe Fallback: <link rel="prefetch">
    if (this.config.navigation?.prefetch === 'same-origin' && typeof document !== 'undefined') {
      try {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url.href;
        link.as = 'document';
        document.head.appendChild(link);
        this.prefetchedUrls.add(url.href);
        method = 'link-prefetch';
        return { prefetched: true, method };
      } catch (e) {
        if (this.config.debug) console.warn('[FastLink] Link prefetch error:', e);
      }
    }

    return { prefetched: false, method: 'none' };
  }

  private handlePointerDown(event: PointerEvent): void {
    this.pendingAnchor = null;
    this.pendingFastAnchor = null;
    this.pressTimestamp = 0;
    this.activePendingIntent = null;

    const anchor = this.findAnchor(event.target, document.body);
    if (!anchor) return;

    const intent = this.resolveEligibility(event, anchor);
    if (!intent) return;

    HANDLED_EVENTS.add(event);
    this.pendingAnchor = anchor;
    this.pressTimestamp = Date.now();
    this.activePendingIntent = intent;

    const currentMode = this.config.mode || 'safe';

    if (currentMode === 'observe') {
      // Observe mode: purely record intent timing without triggering prefetch or navigation
      return;
    }

    if (currentMode === 'safe') {
      // Safe mode: trigger speculative prefetch, DO NOT navigate on pointerdown
      const prefetchResult = this.prefetchUrl(intent.url);
      intent.prefetched = prefetchResult.prefetched;
      intent.prefetchMethod = prefetchResult.method;
      return;
    }

    if (currentMode === 'fast') {
      // An approved route may navigate on pointerup, once a drag-away is ruled out.
      // Navigating on pointerdown cannot distinguish a click from a cancelled drag.
      const isApproved = this.isFastApproved(intent.url.pathname, anchor);
      if (!isApproved) {
        // Fall back to safe prefetch if not in approved fastRoutes
        const prefetchResult = this.prefetchUrl(intent.url);
        intent.prefetched = prefetchResult.prefetched;
        intent.prefetchMethod = prefetchResult.method;
      }
    }
  }

  private handleClick(event: MouseEvent): void {
    if (event.detail === 0) {
      // Keyboard activation (Enter/Space on link) — NEVER suppress
      return;
    }

    if (SUPPRESSED_CLICKS.has(event)) {
      event.preventDefault();
      return;
    }

    const clickAnchor = this.findAnchor(event.target, document.body);

    // If Fast mode triggered early navigation for this anchor, suppress duplicate click
    if (this.pendingFastAnchor && clickAnchor === this.pendingFastAnchor) {
      SUPPRESSED_CLICKS.add(event);
      event.preventDefault(); // Suppress duplicate native navigation
      // NOTE: We NEVER call event.stopPropagation(), preserving analytics tracking!

      const holdDuration = this.pressTimestamp > 0 ? Date.now() - this.pressTimestamp : 0;
      this.emitTelemetry({
        source_path: window.location.pathname,
        destination_path: this.pendingFastAnchor.pathname || this.pendingFastAnchor.getAttribute('href') || '',
        press_duration_ms: holdDuration,
        click_suppressed: true,
        was_aborted: false,
        mode: 'fast',
      });

      this.pendingFastAnchor = null;
      this.pendingAnchor = null;
      this.pressTimestamp = 0;
      this.activePendingIntent = null;
      return;
    }

    // In Safe and Observe modes, confirmed click passes through natively
    if (this.pendingAnchor && clickAnchor === this.pendingAnchor) {
      const holdDuration = this.pressTimestamp > 0 ? Date.now() - this.pressTimestamp : 0;
      this.emitTelemetry({
        source_path: window.location.pathname,
        destination_path: this.pendingAnchor.pathname || this.pendingAnchor.getAttribute('href') || '',
        press_duration_ms: holdDuration,
        click_suppressed: false,
        was_aborted: false,
        mode: this.config.mode || 'safe',
        prefetched: this.activePendingIntent?.prefetched || false,
        prefetch_method: this.activePendingIntent?.prefetchMethod || 'none',
      });

      // If a custom SPA router hook is registered and this is Safe mode, invoke it on confirmed click
      const navHook = (window as any).__FAST_LINK_NAVIGATE__;
      if (this.getMode() === 'safe' && typeof navHook === 'function' && this.activePendingIntent &&
          !event.defaultPrevented && !event.metaKey && !event.ctrlKey &&
          !event.shiftKey && !event.altKey && (event.button === 0 || event.button === undefined)) {
        event.preventDefault();
        navHook(this.activePendingIntent);
      }

      this.pendingAnchor = null;
      this.pressTimestamp = 0;
      this.activePendingIntent = null;
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.pendingAnchor && event.target && !this.pendingAnchor.contains(event.target as Node)) {
      // User pressed on link and dragged pointer outside before releasing -> gesture aborted
      const holdDuration = this.pressTimestamp > 0 ? Date.now() - this.pressTimestamp : 0;
      this.emitTelemetry({
        source_path: window.location.pathname,
        destination_path: this.pendingAnchor.pathname || this.pendingAnchor.getAttribute('href') || '',
        press_duration_ms: holdDuration,
        click_suppressed: false,
        was_aborted: true,
        mode: this.config.mode || 'safe',
      });

      this.pendingAnchor = null;
      this.pendingFastAnchor = null;
      this.pressTimestamp = 0;
      this.activePendingIntent = null;
    } else if (this.getMode() === 'fast' && this.pendingAnchor && this.activePendingIntent &&
      this.isFastApproved(this.activePendingIntent.url.pathname, this.pendingAnchor) &&
      !event.defaultPrevented && event.button === 0 && event.pointerType === 'mouse' &&
      !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
      this.findAnchor(event.target) === this.pendingAnchor) {
      // A completed primary-mouse release on the original link is the earliest
      // point at which a cancelled drag cannot trigger accidental navigation.
      this.pendingFastAnchor = this.pendingAnchor;
      const navHook = (window as any).__FAST_LINK_NAVIGATE__;
      if (typeof navHook === 'function') {
        navHook(this.activePendingIntent);
      } else {
        window.location.assign(this.activePendingIntent.url.href);
      }
    }
  }

  private emitTelemetry(data: any): void {
    if (this.onTelemetryCallback) {
      try {
        this.onTelemetryCallback(data);
      } catch (e) {
        if (this.config.debug) console.warn('[FastLink] Telemetry callback error:', e);
      }
    }
  }

  private attachListeners(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointerdown', this.boundPointerDown, { capture: true, passive: true });
    document.addEventListener('click', this.boundClick, { capture: true });
    document.addEventListener('pointerup', this.boundPointerUp, { capture: true, passive: true });
  }

  public destroy(): void {
    if (this.isDestroyed || typeof document === 'undefined') return;
    document.removeEventListener('pointerdown', this.boundPointerDown, { capture: true });
    document.removeEventListener('click', this.boundClick, { capture: true });
    document.removeEventListener('pointerup', this.boundPointerUp, { capture: true });
    this.isDestroyed = true;
  }
}
