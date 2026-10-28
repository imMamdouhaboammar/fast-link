/**
 * Module B — Measurement & Signal Layer
 * Consent-aware, conversion-safe event handling and ad platform adapters.
 * Guarantees lifecycle separation: Pointer Intent != Click != Lead != Purchase.
 */

import { FastLinkConfig, FastLinkEventPayload } from './types';

const SENSITIVE_QUERY_PARAMS = [
  'token',
  'auth',
  'key',
  'api_key',
  'secret',
  'password',
  'code',
  'access_token',
  'refresh_token',
  'session_id',
  'ssn',
  'card',
];

export class FastLinkSignals {
  private config: FastLinkConfig;
  private dispatchedEventIds = new Set<string>();
  private isDestroyed = false;
  private boundClickHandler: (e: MouseEvent) => void;
  private boundSubmitHandler: (e: SubmitEvent) => void;

  constructor(config: FastLinkConfig = {}) {
    this.config = config;

    this.boundClickHandler = this.handleClick.bind(this);
    this.boundSubmitHandler = this.handleSubmit.bind(this);

    this.attachDomListeners();
  }

  public updateConfig(config: FastLinkConfig): void {
    this.config = config;
  }

  public generateEventId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const rand = Math.random().toString(36).substring(2, 10);
    return `fl_${Date.now()}_${rand}`;
  }

  public hasMarketingConsent(): boolean {
    const consentFn = this.config.signals?.consent;
    if (typeof consentFn !== 'function') {
      return false; // Fail closed if no consent evaluator is defined
    }
    try {
      return consentFn() === true;
    } catch {
      return false;
    }
  }

  public sanitizeUrl(rawUrl: string): string {
    if (this.config.signals?.stripSensitiveParams === false) {
      return rawUrl;
    }
    try {
      const url = new URL(rawUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
      for (const param of SENSITIVE_QUERY_PARAMS) {
        url.searchParams.delete(param);
      }
      return url.href;
    } catch {
      return rawUrl;
    }
  }

  public recordEvent(
    eventName: string,
    properties: Record<string, any> = {},
    options: {
      eventId?: string;
      cta?: string;
      verified?: boolean;
      forceMarketing?: boolean;
    } = {}
  ): string {
    const eventId = options.eventId || this.generateEventId();

    // Prevent duplicate dispatch for the same event_id
    if (this.dispatchedEventIds.has(eventId)) {
      if (this.config.debug) console.warn(`[FastLink Signals] Event ${eventId} already dispatched, deduplicating.`);
      return eventId;
    }
    this.dispatchedEventIds.add(eventId);

    const currentUrl = typeof window !== 'undefined' ? this.sanitizeUrl(window.location.href) : '';
    const payload: FastLinkEventPayload = {
      event_id: eventId,
      event_name: eventName,
      timestamp_ms: Date.now(),
      url: currentUrl,
      mode: this.config.mode || 'safe',
      cta: options.cta,
      verified: options.verified,
      properties: { ...properties },
    };

    // 1. Dispatch to marketing providers if consent is granted
    const consentGranted = this.hasMarketingConsent() || !!options.forceMarketing;
    if (consentGranted) {
      this.dispatchToMeta(eventName, payload, eventId);
      this.dispatchToTikTok(eventName, payload, eventId);
      this.dispatchToGTM(eventName, payload, eventId);
    } else {
      if (this.config.debug) {
        console.info(`[FastLink Signals] Marketing consent withheld for event: ${eventName}. Skipping Meta & TikTok.`);
      }
    }

    // 2. Dispatch to optional first-party server collector
    this.dispatchToCollector(payload);

    return eventId;
  }

  public recordVerifiedLead(properties: Record<string, any> = {}, eventId?: string): string {
    return this.recordEvent('Lead', properties, {
      eventId,
      verified: true,
    });
  }

  public recordVerifiedPurchase(
    properties: { value?: number; currency?: string; transaction_id?: string; [k: string]: any } = {},
    eventId?: string
  ): string {
    return this.recordEvent('Purchase', properties, {
      eventId,
      verified: true,
    });
  }

  private dispatchToMeta(eventName: string, payload: FastLinkEventPayload, eventId: string): void {
    if (this.config.signals?.providers?.meta === false) return;
    if (typeof window === 'undefined') return;

    const fbq = (window as any).fbq;
    if (typeof fbq !== 'function') return;

    const standardEvents = new Set([
      'AddPaymentInfo',
      'AddToCart',
      'AddToWishlist',
      'CompleteRegistration',
      'Contact',
      'CustomizeProduct',
      'Donate',
      'FindLocation',
      'InitiateCheckout',
      'Lead',
      'Purchase',
      'Schedule',
      'Search',
      'StartTrial',
      'SubmitApplication',
      'Subscribe',
      'ViewContent',
    ]);

    const isStandard = standardEvents.has(eventName);
    const action = isStandard ? 'track' : 'trackCustom';

    try {
      fbq(action, eventName, payload.properties || {}, { eventID: eventId });
      if (this.config.debug) console.log(`[FastLink Signals] Meta Pixel ${action}:`, eventName, eventId);
    } catch (e) {
      if (this.config.debug) console.warn('[FastLink Signals] Meta Pixel error:', e);
    }
  }

  private dispatchToTikTok(eventName: string, payload: FastLinkEventPayload, eventId: string): void {
    if (this.config.signals?.providers?.tiktok === false) return;
    if (typeof window === 'undefined') return;

    const ttq = (window as any).ttq;
    if (!ttq || typeof ttq.track !== 'function') return;

    try {
      ttq.track(eventName, payload.properties || {}, { event_id: eventId });
      if (this.config.debug) console.log('[FastLink Signals] TikTok Pixel track:', eventName, eventId);
    } catch (e) {
      if (this.config.debug) console.warn('[FastLink Signals] TikTok Pixel error:', e);
    }
  }

  private dispatchToGTM(eventName: string, payload: FastLinkEventPayload, eventId: string): void {
    if (this.config.signals?.providers?.gtm === false) return;
    if (typeof window === 'undefined') return;

    const dataLayer = (window as any).dataLayer;
    if (!Array.isArray(dataLayer)) return;

    try {
      dataLayer.push({
        event: eventName,
        event_id: eventId,
        fastlink: {
          mode: payload.mode,
          cta: payload.cta,
          verified: payload.verified,
          ...payload.properties,
        },
      });
      if (this.config.debug) console.log('[FastLink Signals] GTM dataLayer push:', eventName, eventId);
    } catch (e) {
      if (this.config.debug) console.warn('[FastLink Signals] GTM push error:', e);
    }
  }

  public dispatchToCollector(payload: FastLinkEventPayload): void {
    const endpoint = this.config.signals?.collector;
    if (!endpoint || typeof window === 'undefined') return;

    try {
      const dataStr = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, dataStr);
      } else {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: dataStr,
          keepalive: true,
        }).catch(() => {});
      }
    } catch (e) {
      if (this.config.debug) console.warn('[FastLink Signals] Collector transmission error:', e);
    }
  }

  private handleClick(event: MouseEvent): void {
    let target = event.target instanceof Element ? event.target : null;
    let el: Element | null = target;

    while (el && el !== document.body) {
      const customEvent = el.getAttribute('data-fl-event');
      if (customEvent) {
        const cta = el.getAttribute('data-fl-cta') || undefined;
        this.recordEvent(customEvent, {}, { cta });
        return;
      }
      el = el.parentElement;
    }
  }

  private handleSubmit(event: SubmitEvent): void {
    const form = event.target as HTMLFormElement;
    if (!form) return;

    const formType = form.getAttribute('data-fl-form');
    if (formType) {
      // Invariant: Form submission attempt is NOT a verified lead.
      // We record 'FormAttempt' or 'InitiateLead', never 'Lead' on client submit gesture!
      this.recordEvent('FormAttempt', { form_type: formType, form_id: form.id || form.name || 'unnamed' });
    }
  }

  private attachDomListeners(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', this.boundClickHandler, { capture: true });
    document.addEventListener('submit', this.boundSubmitHandler, { capture: true });
  }

  public destroy(): void {
    if (this.isDestroyed || typeof document === 'undefined') return;
    document.removeEventListener('click', this.boundClickHandler, { capture: true });
    document.removeEventListener('submit', this.boundSubmitHandler, { capture: true });
    this.isDestroyed = true;
  }
}
