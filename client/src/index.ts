/**
 * FastLink Universal Browser Runtime v1.0.0
 * Framework-independent interaction and navigation system for paid-traffic landing pages.
 */

import { FastLinkCore } from './core';
import { FastLinkSignals } from './signals';
import { FastLinkConfig, FastLinkEventPayload, FastLinkIntent, FastLinkMode } from './types';

export * from './types';
export { FastLinkCore } from './core';
export { FastLinkSignals } from './signals';

export class FastLinkRuntime {
  public core: FastLinkCore;
  public signals: FastLinkSignals;
  private config: FastLinkConfig;

  constructor(config: FastLinkConfig = {}) {
    this.config = {
      mode: config.mode || 'safe',
      navigation: {
        prefetch: 'same-origin',
        preserveNativeClicks: true,
        exclude: ['/api/*', '/auth/*', '/logout', '/admin/*'],
        fastRoutes: [],
        matchDataFastLinkOnly: false,
        timeoutMs: 5000,
        ...config.navigation,
      },
      signals: {
        collector: config.signals?.collector || (typeof window !== 'undefined' ? (window as any).__FAST_LINK_TELEMETRY__ || '/api/v1/telemetry' : undefined),
        providers: {
          meta: true,
          tiktok: true,
          gtm: true,
          ...config.signals?.providers,
        },
        stripSensitiveParams: true,
        ...config.signals,
      },
      debug: !!config.debug,
    };

    this.signals = new FastLinkSignals(this.config);

    this.core = new FastLinkCore(this.config, (telemetryData: any) => {
      // Forward interaction timing / abort telemetry to the collector
      const eventPayload: FastLinkEventPayload = {
        event_id: this.signals.generateEventId(),
        event_name: 'InteractionTiming',
        timestamp_ms: Date.now(),
        url: typeof window !== 'undefined' ? this.signals.sanitizeUrl(window.location.href) : '',
        mode: this.core.getMode(),
        press_duration_ms: telemetryData.press_duration_ms,
        was_aborted: telemetryData.was_aborted,
        click_suppressed: telemetryData.click_suppressed,
        prefetched: telemetryData.prefetched,
        prefetch_method: telemetryData.prefetch_method,
        properties: {
          source_path: telemetryData.source_path,
          destination_path: telemetryData.destination_path,
        },
      };
      this.signals.dispatchToCollector(eventPayload);
    });
  }

  public getMode(): FastLinkMode {
    return this.core.getMode();
  }

  public setMode(mode: FastLinkMode): void {
    this.core.setMode(mode);
    this.config.mode = mode;
    this.signals.updateConfig(this.config);
  }

  public prefetch(urlStr: string): { prefetched: boolean; method?: FastLinkIntent['prefetchMethod'] } {
    try {
      const baseUri = typeof document !== 'undefined' ? document.baseURI : 'http://localhost';
      const resolved = new URL(urlStr, baseUri);
      return this.core.prefetchUrl(resolved);
    } catch {
      return { prefetched: false, method: 'none' };
    }
  }

  public recordEvent(eventName: string, properties: Record<string, any> = {}, options: any = {}): string {
    return this.signals.recordEvent(eventName, properties, options);
  }

  public recordVerifiedLead(properties: Record<string, any> = {}, eventId?: string): string {
    return this.signals.recordVerifiedLead(properties, eventId);
  }

  public recordVerifiedPurchase(properties: any = {}, eventId?: string): string {
    return this.signals.recordVerifiedPurchase(properties, eventId);
  }

  public getState() {
    return {
      mode: this.core.getMode(),
      prefetchedUrls: this.core.getPrefetchedUrls(),
      hasConsent: this.signals.hasMarketingConsent(),
    };
  }

  public destroy(): void {
    this.core.destroy();
    this.signals.destroy();
  }
}

// Global browser singleton
let globalInstance: FastLinkRuntime | null = null;

export const FastLink = {
  init(config: FastLinkConfig = {}): FastLinkRuntime {
    if (globalInstance) {
      globalInstance.destroy();
    }
    globalInstance = new FastLinkRuntime(config);
    if (typeof window !== 'undefined') {
      (window as any).FastLink = FastLink;
      (window as any).__FAST_LINK_INSTANCE__ = globalInstance;
    }
    return globalInstance;
  },

  get instance(): FastLinkRuntime | null {
    return globalInstance;
  },

  getMode(): FastLinkMode {
    return globalInstance ? globalInstance.getMode() : 'safe';
  },

  setMode(mode: FastLinkMode): void {
    if (globalInstance) globalInstance.setMode(mode);
  },

  prefetch(url: string) {
    return globalInstance ? globalInstance.prefetch(url) : { prefetched: false, method: 'none' };
  },

  recordEvent(eventName: string, properties: Record<string, any> = {}, options: any = {}): string {
    return globalInstance ? globalInstance.recordEvent(eventName, properties, options) : '';
  },

  recordVerifiedLead(properties: Record<string, any> = {}, eventId?: string): string {
    return globalInstance ? globalInstance.recordVerifiedLead(properties, eventId) : '';
  },

  recordVerifiedPurchase(properties: any = {}, eventId?: string): string {
    return globalInstance ? globalInstance.recordVerifiedPurchase(properties, eventId) : '';
  },

  getState() {
    return globalInstance ? globalInstance.getState() : { mode: 'safe', prefetchedUrls: [], hasConsent: false };
  },

  destroy(): void {
    if (globalInstance) {
      globalInstance.destroy();
      globalInstance = null;
    }
  },
};

// Auto-initialize if running in a browser environment
if (typeof window !== 'undefined') {
  (window as any).FastLink = FastLink;
  const existingConfig = (window as any).__FAST_LINK_CONFIG__ || {};
  if (!(window as any).__FAST_LINK_INITIALIZED__) {
    (window as any).__FAST_LINK_INITIALIZED__ = true;
    FastLink.init(existingConfig);
  }
}

export default FastLink;
