/**
 * FastLink Types & Interfaces
 * Framework-independent interaction and navigation system for paid-traffic landing pages.
 */

export type FastLinkMode = 'observe' | 'safe' | 'fast';

export interface FastLinkNavigationConfig {
  /**
   * Prefetch strategy for eligible routes.
   * - 'same-origin': Uses Speculation Rules API if available, falling back to <link rel="prefetch">.
   * - 'speculationrules': Uses only Speculation Rules API.
   * - 'none': Disables prefetching entirely.
   * @default 'same-origin'
   */
  prefetch?: 'same-origin' | 'speculationrules' | 'none';

  /**
   * Whether to preserve native browser click events for analytics and custom listeners.
   * @default true
   */
  preserveNativeClicks?: boolean;

  /**
   * Path patterns to strictly exclude from prefetch and early navigation.
   * e.g. ["/logout", "/admin/*", "/api/*", "/auth/*"]
   */
  exclude?: string[];

  /**
   * Explicitly permitted routes for 'fast' mode early navigation.
   * In 'fast' mode, any route not in this list falls back to 'safe' mode.
   */
  fastRoutes?: string[];

  /**
   * If true, only anchors bearing data-fast-link="true" are eligible.
   * Useful for targeted optimization or reverse proxy injection workflows.
   * @default false
   */
  matchDataFastLinkOnly?: boolean;

  /**
   * Timeout in ms after pointerdown before pending state auto-expires if no release occurs.
   * @default 5000
   */
  timeoutMs?: number;
}

export interface FastLinkSignalProviders {
  /**
   * Meta Pixel (window.fbq) integration.
   * @default true
   */
  meta?: boolean;

  /**
   * TikTok Pixel (window.ttq) integration.
   * @default true
   */
  tiktok?: boolean;

  /**
   * Google Tag Manager (window.dataLayer) integration.
   * @default true
   */
  gtm?: boolean;
}

export interface FastLinkSignalsConfig {
  /**
   * Optional first-party event collector endpoint.
   * e.g. "/api/v1/events" or "/api/fastlink/events"
   */
  collector?: string;

  /**
   * User consent evaluator.
   * Must return true before marketing platform pixels (Meta, TikTok) are called.
   * If false, undefined, or an error is thrown, marketing signals are blocked.
   */
  consent?: () => boolean;

  /**
   * Enabled marketing signal providers.
   */
  providers?: FastLinkSignalProviders;

  /**
   * Whether to sanitize sensitive query parameters (tokens, passwords, keys) from tracked URLs.
   * @default true
   */
  stripSensitiveParams?: boolean;
}

export interface FastLinkConfig {
  /**
   * Operational navigation mode:
   * - 'observe': Read-only observation of interaction timing, aborts, and clicks. No navigation modification.
   * - 'safe': Speculative prefetch on pointerdown; native click lifecycle and routing preserved. (DEFAULT)
   * - 'fast': Early navigation on pointerdown for explicitly approved routes.
   * @default 'safe'
   */
  mode?: FastLinkMode;

  /**
   * Navigation engine configuration.
   */
  navigation?: FastLinkNavigationConfig;

  /**
   * Marketing measurement and signal layer configuration.
   */
  signals?: FastLinkSignalsConfig;

  /**
   * Enable verbose console logging for debugging.
   * @default false
   */
  debug?: boolean;
}

export interface FastLinkIntent {
  anchor: HTMLAnchorElement;
  href: string;
  url: URL;
  mode: FastLinkMode;
  prefetched: boolean;
  prefetchMethod?: 'speculationrules' | 'link-prefetch' | 'fetch-cache' | 'none';
}

export interface FastLinkEventPayload {
  event_id: string;
  event_name: string;
  timestamp_ms: number;
  url: string;
  mode: FastLinkMode;
  cta?: string;
  press_duration_ms?: number;
  was_aborted?: boolean;
  click_suppressed?: boolean;
  prefetched?: boolean;
  prefetch_method?: string;
  verified?: boolean;
  properties?: Record<string, any>;
}
