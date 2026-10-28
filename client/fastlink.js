/* FastLink Universal Browser Runtime v1.0.0 */
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  function __accessProp(key) {
    return this[key];
  }
  var __toCommonJS = (from) => {
    var entry = (__moduleCache ??= new WeakMap).get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function") {
      for (var key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(entry, key))
          __defProp(entry, key, {
            get: __accessProp.bind(from, key),
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
          });
    }
    __moduleCache.set(from, entry);
    return entry;
  };
  var __moduleCache;
  var __returnValue = (v) => v;
  function __exportSetter(name, newValue) {
    this[name] = __returnValue.bind(null, newValue);
  }
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: __exportSetter.bind(all, name)
      });
  };

  // client/src/index.ts
  var exports_src = {};
  __export(exports_src, {
    FastLink: () => FastLink,
    FastLinkCore: () => FastLinkCore,
    FastLinkRuntime: () => FastLinkRuntime,
    FastLinkSignals: () => FastLinkSignals,
    default: () => src_default
  });

  // client/src/core.ts
  var HANDLED_EVENTS = new WeakSet;
  var SUPPRESSED_CLICKS = new WeakSet;
  var NESTED_TAGS = {
    BUTTON: 1,
    INPUT: 1,
    LABEL: 1,
    SELECT: 1,
    SUMMARY: 1,
    TEXTAREA: 1
  };
  var BUTTON_ROLE_REGEX = /(?:^|[\t\n\f\r ])button(?:$|[\t\n\f\r ])/i;
  var LINK_ROLE_REGEX = /^[\t\n\f\r ]*(?:link)?[\t\n\f\r ]*$/i;

  class FastLinkCore {
    config;
    pendingAnchor = null;
    pendingFastAnchor = null;
    pressTimestamp = 0;
    prefetchedUrls = new Set;
    activePendingIntent = null;
    boundPointerDown;
    boundPointerUp;
    boundClick;
    onTelemetryCallback;
    isDestroyed = false;
    constructor(config = {}, onTelemetry) {
      this.config = {
        mode: config.mode || "safe",
        navigation: {
          prefetch: config.navigation?.prefetch || "same-origin",
          preserveNativeClicks: config.navigation?.preserveNativeClicks !== false,
          exclude: config.navigation?.exclude || ["/api/*", "/auth/*", "/logout", "/admin/*"],
          fastRoutes: config.navigation?.fastRoutes || [],
          matchDataFastLinkOnly: config.navigation?.matchDataFastLinkOnly || false,
          timeoutMs: config.navigation?.timeoutMs || 5000
        },
        signals: config.signals || {},
        debug: !!config.debug
      };
      this.onTelemetryCallback = onTelemetry;
      this.boundPointerDown = this.handlePointerDown.bind(this);
      this.boundPointerUp = this.handlePointerUp.bind(this);
      this.boundClick = this.handleClick.bind(this);
      this.attachListeners();
    }
    getMode() {
      return this.config.mode || "safe";
    }
    setMode(mode) {
      this.config.mode = mode;
    }
    getPrefetchedUrls() {
      return Array.from(this.prefetchedUrls);
    }
    findAnchor(target, boundary = document.body) {
      let el = target instanceof Element ? target : target && target.parentElement ? target.parentElement : null;
      while (el && el !== boundary) {
        if (el.tagName === "A" && el.hasAttribute("href")) {
          return el;
        }
        el = el.parentElement;
      }
      return el && el.tagName === "A" && el.hasAttribute("href") ? el : null;
    }
    isOptedOut(target, anchor) {
      if (anchor.hasAttribute("data-no-fast-link"))
        return true;
      const role = anchor.getAttribute("role");
      if (role && !LINK_ROLE_REGEX.test(role))
        return true;
      let el = target instanceof Element ? target : null;
      while (el && el !== anchor) {
        if (el.hasAttribute("data-no-fast-link"))
          return true;
        if (NESTED_TAGS[el.tagName])
          return true;
        const elRole = el.getAttribute("role");
        if (elRole && BUTTON_ROLE_REGEX.test(elRole))
          return true;
        el = el.parentElement;
      }
      return false;
    }
    isExcluded(pathname) {
      const exclusions = this.config.navigation?.exclude || [];
      for (const pattern of exclusions) {
        if (pattern.endsWith("/*")) {
          const prefix = pattern.slice(0, -2);
          if (pathname.startsWith(prefix))
            return true;
        } else if (pattern.endsWith("*")) {
          const prefix = pattern.slice(0, -1);
          if (pathname.startsWith(prefix))
            return true;
        } else if (pathname === pattern) {
          return true;
        }
      }
      return false;
    }
    isFastApproved(pathname, anchor) {
      if (anchor.getAttribute("data-fl-fast") === "true")
        return true;
      const approved = this.config.navigation?.fastRoutes || [];
      for (const pattern of approved) {
        if (pattern.endsWith("/*")) {
          const prefix = pattern.slice(0, -2);
          if (pathname.startsWith(prefix))
            return true;
        } else if (pathname === pattern) {
          return true;
        }
      }
      return false;
    }
    resolveEligibility(event, anchor) {
      if (event) {
        if (event.defaultPrevented || event.button !== 0 || event.pointerType !== "mouse" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || HANDLED_EVENTS.has(event)) {
          return null;
        }
      }
      if (this.isOptedOut(event ? event.target : null, anchor))
        return null;
      if (this.config.navigation?.matchDataFastLinkOnly && !anchor.hasAttribute("data-fast-link")) {
        return null;
      }
      const targetAttr = anchor.getAttribute("target");
      if (targetAttr && targetAttr !== "_self")
        return null;
      if (anchor.hasAttribute("download"))
        return null;
      const href = anchor.getAttribute("href");
      if (!href || href.charAt(0) === "#")
        return null;
      try {
        const baseUri = document.baseURI || window.location.href;
        const resolved = new URL(href, baseUri);
        if (resolved.origin !== window.location.origin)
          return null;
        if (this.isExcluded(resolved.pathname))
          return null;
        return {
          anchor,
          href,
          url: resolved,
          mode: this.config.mode || "safe",
          prefetched: this.prefetchedUrls.has(resolved.href)
        };
      } catch {
        return null;
      }
    }
    prefetchUrl(url) {
      if (this.prefetchedUrls.has(url.href)) {
        return { prefetched: true, method: "none" };
      }
      const conn = navigator.connection;
      if (conn && (conn.saveData || conn.effectiveType === "2g")) {
        if (this.config.debug)
          console.warn("[FastLink] Prefetch skipped due to Save-Data or slow connection.");
        return { prefetched: false, method: "none" };
      }
      if (this.config.navigation?.prefetch === "none") {
        return { prefetched: false, method: "none" };
      }
      let method = "none";
      const hasSpeculationRules = typeof HTMLScriptElement !== "undefined" && typeof HTMLScriptElement.supports === "function" && HTMLScriptElement.supports("speculationrules");
      if (hasSpeculationRules && this.config.navigation?.prefetch !== "none") {
        try {
          const specScript = document.createElement("script");
          specScript.type = "speculationrules";
          specScript.textContent = JSON.stringify({
            prefetch: [
              {
                source: "list",
                urls: [url.href]
              }
            ]
          });
          document.head.appendChild(specScript);
          this.prefetchedUrls.add(url.href);
          method = "speculationrules";
          return { prefetched: true, method };
        } catch (e) {
          if (this.config.debug)
            console.warn("[FastLink] SpeculationRules error:", e);
        }
      }
      if (this.config.navigation?.prefetch === "same-origin" && typeof document !== "undefined") {
        try {
          const link = document.createElement("link");
          link.rel = "prefetch";
          link.href = url.href;
          link.as = "document";
          document.head.appendChild(link);
          this.prefetchedUrls.add(url.href);
          method = "link-prefetch";
          return { prefetched: true, method };
        } catch (e) {
          if (this.config.debug)
            console.warn("[FastLink] Link prefetch error:", e);
        }
      }
      return { prefetched: false, method: "none" };
    }
    handlePointerDown(event) {
      this.pendingAnchor = null;
      this.pendingFastAnchor = null;
      this.pressTimestamp = 0;
      this.activePendingIntent = null;
      const anchor = this.findAnchor(event.target, document.body);
      if (!anchor)
        return;
      const intent = this.resolveEligibility(event, anchor);
      if (!intent)
        return;
      HANDLED_EVENTS.add(event);
      this.pendingAnchor = anchor;
      this.pressTimestamp = Date.now();
      this.activePendingIntent = intent;
      const currentMode = this.config.mode || "safe";
      if (currentMode === "observe") {
        return;
      }
      if (currentMode === "safe") {
        const prefetchResult = this.prefetchUrl(intent.url);
        intent.prefetched = prefetchResult.prefetched;
        intent.prefetchMethod = prefetchResult.method;
        return;
      }
      if (currentMode === "fast") {
        const isApproved = this.isFastApproved(intent.url.pathname, anchor);
        if (isApproved) {
          this.pendingFastAnchor = anchor;
          const navHook = window.__FAST_LINK_NAVIGATE__;
          if (typeof navHook === "function") {
            navHook(intent);
          } else {
            window.location.assign(intent.url.href);
          }
        } else {
          const prefetchResult = this.prefetchUrl(intent.url);
          intent.prefetched = prefetchResult.prefetched;
          intent.prefetchMethod = prefetchResult.method;
        }
      }
    }
    handleClick(event) {
      if (event.detail === 0) {
        return;
      }
      if (SUPPRESSED_CLICKS.has(event)) {
        event.preventDefault();
        return;
      }
      const clickAnchor = this.findAnchor(event.target, document.body);
      if (this.pendingFastAnchor && clickAnchor === this.pendingFastAnchor) {
        SUPPRESSED_CLICKS.add(event);
        event.preventDefault();
        const holdDuration = this.pressTimestamp > 0 ? Date.now() - this.pressTimestamp : 0;
        this.emitTelemetry({
          source_path: window.location.pathname,
          destination_path: this.pendingFastAnchor.pathname || this.pendingFastAnchor.getAttribute("href") || "",
          press_duration_ms: holdDuration,
          click_suppressed: true,
          was_aborted: false,
          mode: "fast"
        });
        this.pendingFastAnchor = null;
        this.pendingAnchor = null;
        this.pressTimestamp = 0;
        this.activePendingIntent = null;
        return;
      }
      if (this.pendingAnchor && clickAnchor === this.pendingAnchor) {
        const holdDuration = this.pressTimestamp > 0 ? Date.now() - this.pressTimestamp : 0;
        this.emitTelemetry({
          source_path: window.location.pathname,
          destination_path: this.pendingAnchor.pathname || this.pendingAnchor.getAttribute("href") || "",
          press_duration_ms: holdDuration,
          click_suppressed: false,
          was_aborted: false,
          mode: this.config.mode || "safe",
          prefetched: this.activePendingIntent?.prefetched || false,
          prefetch_method: this.activePendingIntent?.prefetchMethod || "none"
        });
        const navHook = window.__FAST_LINK_NAVIGATE__;
        if (typeof navHook === "function" && this.activePendingIntent) {
          event.preventDefault();
          navHook(this.activePendingIntent);
        }
        this.pendingAnchor = null;
        this.pressTimestamp = 0;
        this.activePendingIntent = null;
      }
    }
    handlePointerUp(event) {
      if (this.pendingAnchor && event.target && !this.pendingAnchor.contains(event.target)) {
        const holdDuration = this.pressTimestamp > 0 ? Date.now() - this.pressTimestamp : 0;
        this.emitTelemetry({
          source_path: window.location.pathname,
          destination_path: this.pendingAnchor.pathname || this.pendingAnchor.getAttribute("href") || "",
          press_duration_ms: holdDuration,
          click_suppressed: false,
          was_aborted: true,
          mode: this.config.mode || "safe"
        });
        this.pendingAnchor = null;
        this.pendingFastAnchor = null;
        this.pressTimestamp = 0;
        this.activePendingIntent = null;
      }
    }
    emitTelemetry(data) {
      if (this.onTelemetryCallback) {
        try {
          this.onTelemetryCallback(data);
        } catch (e) {
          if (this.config.debug)
            console.warn("[FastLink] Telemetry callback error:", e);
        }
      }
    }
    attachListeners() {
      if (typeof document === "undefined")
        return;
      document.addEventListener("pointerdown", this.boundPointerDown, { capture: true, passive: true });
      document.addEventListener("click", this.boundClick, { capture: true });
      document.addEventListener("pointerup", this.boundPointerUp, { capture: true, passive: true });
    }
    destroy() {
      if (this.isDestroyed || typeof document === "undefined")
        return;
      document.removeEventListener("pointerdown", this.boundPointerDown, { capture: true });
      document.removeEventListener("click", this.boundClick, { capture: true });
      document.removeEventListener("pointerup", this.boundPointerUp, { capture: true });
      this.isDestroyed = true;
    }
  }

  // client/src/signals.ts
  var SENSITIVE_QUERY_PARAMS = [
    "token",
    "auth",
    "key",
    "api_key",
    "secret",
    "password",
    "code",
    "access_token",
    "refresh_token",
    "session_id",
    "ssn",
    "card"
  ];

  class FastLinkSignals {
    config;
    dispatchedEventIds = new Set;
    isDestroyed = false;
    boundClickHandler;
    boundSubmitHandler;
    constructor(config = {}) {
      this.config = config;
      this.boundClickHandler = this.handleClick.bind(this);
      this.boundSubmitHandler = this.handleSubmit.bind(this);
      this.attachDomListeners();
    }
    updateConfig(config) {
      this.config = config;
    }
    generateEventId() {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
      const rand = Math.random().toString(36).substring(2, 10);
      return `fl_${Date.now()}_${rand}`;
    }
    hasMarketingConsent() {
      const consentFn = this.config.signals?.consent;
      if (typeof consentFn !== "function") {
        return false;
      }
      try {
        return consentFn() === true;
      } catch {
        return false;
      }
    }
    sanitizeUrl(rawUrl) {
      if (this.config.signals?.stripSensitiveParams === false) {
        return rawUrl;
      }
      try {
        const url = new URL(rawUrl, typeof window !== "undefined" ? window.location.href : "http://localhost");
        for (const param of SENSITIVE_QUERY_PARAMS) {
          url.searchParams.delete(param);
        }
        return url.href;
      } catch {
        return rawUrl;
      }
    }
    recordEvent(eventName, properties = {}, options = {}) {
      const eventId = options.eventId || this.generateEventId();
      if (this.dispatchedEventIds.has(eventId)) {
        if (this.config.debug)
          console.warn(`[FastLink Signals] Event ${eventId} already dispatched, deduplicating.`);
        return eventId;
      }
      this.dispatchedEventIds.add(eventId);
      const currentUrl = typeof window !== "undefined" ? this.sanitizeUrl(window.location.href) : "";
      const payload = {
        event_id: eventId,
        event_name: eventName,
        timestamp_ms: Date.now(),
        url: currentUrl,
        mode: this.config.mode || "safe",
        cta: options.cta,
        verified: options.verified,
        properties: { ...properties }
      };
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
      this.dispatchToCollector(payload);
      return eventId;
    }
    recordVerifiedLead(properties = {}, eventId) {
      return this.recordEvent("Lead", properties, {
        eventId,
        verified: true
      });
    }
    recordVerifiedPurchase(properties = {}, eventId) {
      return this.recordEvent("Purchase", properties, {
        eventId,
        verified: true
      });
    }
    dispatchToMeta(eventName, payload, eventId) {
      if (this.config.signals?.providers?.meta === false)
        return;
      if (typeof window === "undefined")
        return;
      const fbq = window.fbq;
      if (typeof fbq !== "function")
        return;
      const standardEvents = new Set([
        "AddPaymentInfo",
        "AddToCart",
        "AddToWishlist",
        "CompleteRegistration",
        "Contact",
        "CustomizeProduct",
        "Donate",
        "FindLocation",
        "InitiateCheckout",
        "Lead",
        "Purchase",
        "Schedule",
        "Search",
        "StartTrial",
        "SubmitApplication",
        "Subscribe",
        "ViewContent"
      ]);
      const isStandard = standardEvents.has(eventName);
      const action = isStandard ? "track" : "trackCustom";
      try {
        fbq(action, eventName, payload.properties || {}, { eventID: eventId });
        if (this.config.debug)
          console.log(`[FastLink Signals] Meta Pixel ${action}:`, eventName, eventId);
      } catch (e) {
        if (this.config.debug)
          console.warn("[FastLink Signals] Meta Pixel error:", e);
      }
    }
    dispatchToTikTok(eventName, payload, eventId) {
      if (this.config.signals?.providers?.tiktok === false)
        return;
      if (typeof window === "undefined")
        return;
      const ttq = window.ttq;
      if (!ttq || typeof ttq.track !== "function")
        return;
      try {
        ttq.track(eventName, payload.properties || {}, { event_id: eventId });
        if (this.config.debug)
          console.log("[FastLink Signals] TikTok Pixel track:", eventName, eventId);
      } catch (e) {
        if (this.config.debug)
          console.warn("[FastLink Signals] TikTok Pixel error:", e);
      }
    }
    dispatchToGTM(eventName, payload, eventId) {
      if (this.config.signals?.providers?.gtm === false)
        return;
      if (typeof window === "undefined")
        return;
      const dataLayer = window.dataLayer;
      if (!Array.isArray(dataLayer))
        return;
      try {
        dataLayer.push({
          event: eventName,
          event_id: eventId,
          fastlink: {
            mode: payload.mode,
            cta: payload.cta,
            verified: payload.verified,
            ...payload.properties
          }
        });
        if (this.config.debug)
          console.log("[FastLink Signals] GTM dataLayer push:", eventName, eventId);
      } catch (e) {
        if (this.config.debug)
          console.warn("[FastLink Signals] GTM push error:", e);
      }
    }
    dispatchToCollector(payload) {
      const endpoint = this.config.signals?.collector;
      if (!endpoint || typeof window === "undefined")
        return;
      try {
        const dataStr = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          navigator.sendBeacon(endpoint, dataStr);
        } else {
          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: dataStr,
            keepalive: true
          }).catch(() => {});
        }
      } catch (e) {
        if (this.config.debug)
          console.warn("[FastLink Signals] Collector transmission error:", e);
      }
    }
    handleClick(event) {
      let target = event.target instanceof Element ? event.target : null;
      let el = target;
      while (el && el !== document.body) {
        const customEvent = el.getAttribute("data-fl-event");
        if (customEvent) {
          const cta = el.getAttribute("data-fl-cta") || undefined;
          this.recordEvent(customEvent, {}, { cta });
          return;
        }
        el = el.parentElement;
      }
    }
    handleSubmit(event) {
      const form = event.target;
      if (!form)
        return;
      const formType = form.getAttribute("data-fl-form");
      if (formType) {
        this.recordEvent("FormAttempt", { form_type: formType, form_id: form.id || form.name || "unnamed" });
      }
    }
    attachDomListeners() {
      if (typeof document === "undefined")
        return;
      document.addEventListener("click", this.boundClickHandler, { capture: true });
      document.addEventListener("submit", this.boundSubmitHandler, { capture: true });
    }
    destroy() {
      if (this.isDestroyed || typeof document === "undefined")
        return;
      document.removeEventListener("click", this.boundClickHandler, { capture: true });
      document.removeEventListener("submit", this.boundSubmitHandler, { capture: true });
      this.isDestroyed = true;
    }
  }

  // client/src/index.ts
  class FastLinkRuntime {
    core;
    signals;
    config;
    constructor(config = {}) {
      this.config = {
        mode: config.mode || "safe",
        navigation: {
          prefetch: "same-origin",
          preserveNativeClicks: true,
          exclude: ["/api/*", "/auth/*", "/logout", "/admin/*"],
          fastRoutes: [],
          matchDataFastLinkOnly: false,
          timeoutMs: 5000,
          ...config.navigation
        },
        signals: {
          collector: config.signals?.collector || (typeof window !== "undefined" ? window.__FAST_LINK_TELEMETRY__ || "/api/v1/telemetry" : undefined),
          providers: {
            meta: true,
            tiktok: true,
            gtm: true,
            ...config.signals?.providers
          },
          stripSensitiveParams: true,
          ...config.signals
        },
        debug: !!config.debug
      };
      this.signals = new FastLinkSignals(this.config);
      this.core = new FastLinkCore(this.config, (telemetryData) => {
        const eventPayload = {
          event_id: this.signals.generateEventId(),
          event_name: "InteractionTiming",
          timestamp_ms: Date.now(),
          url: typeof window !== "undefined" ? this.signals.sanitizeUrl(window.location.href) : "",
          mode: this.core.getMode(),
          press_duration_ms: telemetryData.press_duration_ms,
          was_aborted: telemetryData.was_aborted,
          click_suppressed: telemetryData.click_suppressed,
          prefetched: telemetryData.prefetched,
          prefetch_method: telemetryData.prefetch_method,
          properties: {
            source_path: telemetryData.source_path,
            destination_path: telemetryData.destination_path
          }
        };
        this.signals.dispatchToCollector(eventPayload);
      });
    }
    getMode() {
      return this.core.getMode();
    }
    setMode(mode) {
      this.core.setMode(mode);
      this.config.mode = mode;
      this.signals.updateConfig(this.config);
    }
    prefetch(urlStr) {
      try {
        const baseUri = typeof document !== "undefined" ? document.baseURI : "http://localhost";
        const resolved = new URL(urlStr, baseUri);
        return this.core.prefetchUrl(resolved);
      } catch {
        return { prefetched: false, method: "none" };
      }
    }
    recordEvent(eventName, properties = {}, options = {}) {
      return this.signals.recordEvent(eventName, properties, options);
    }
    recordVerifiedLead(properties = {}, eventId) {
      return this.signals.recordVerifiedLead(properties, eventId);
    }
    recordVerifiedPurchase(properties = {}, eventId) {
      return this.signals.recordVerifiedPurchase(properties, eventId);
    }
    getState() {
      return {
        mode: this.core.getMode(),
        prefetchedUrls: this.core.getPrefetchedUrls(),
        hasConsent: this.signals.hasMarketingConsent()
      };
    }
    destroy() {
      this.core.destroy();
      this.signals.destroy();
    }
  }
  var globalInstance = null;
  var FastLink = {
    init(config = {}) {
      if (globalInstance) {
        globalInstance.destroy();
      }
      globalInstance = new FastLinkRuntime(config);
      if (typeof window !== "undefined") {
        window.FastLink = FastLink;
        window.__FAST_LINK_INSTANCE__ = globalInstance;
      }
      return globalInstance;
    },
    get instance() {
      return globalInstance;
    },
    getMode() {
      return globalInstance ? globalInstance.getMode() : "safe";
    },
    setMode(mode) {
      if (globalInstance)
        globalInstance.setMode(mode);
    },
    prefetch(url) {
      return globalInstance ? globalInstance.prefetch(url) : { prefetched: false, method: "none" };
    },
    recordEvent(eventName, properties = {}, options = {}) {
      return globalInstance ? globalInstance.recordEvent(eventName, properties, options) : "";
    },
    recordVerifiedLead(properties = {}, eventId) {
      return globalInstance ? globalInstance.recordVerifiedLead(properties, eventId) : "";
    },
    recordVerifiedPurchase(properties = {}, eventId) {
      return globalInstance ? globalInstance.recordVerifiedPurchase(properties, eventId) : "";
    },
    getState() {
      return globalInstance ? globalInstance.getState() : { mode: "safe", prefetchedUrls: [], hasConsent: false };
    },
    destroy() {
      if (globalInstance) {
        globalInstance.destroy();
        globalInstance = null;
      }
    }
  };
  if (typeof window !== "undefined") {
    window.FastLink = FastLink;
    const existingConfig = window.__FAST_LINK_CONFIG__ || {};
    if (!window.__FAST_LINK_INITIALIZED__) {
      window.__FAST_LINK_INITIALIZED__ = true;
      FastLink.init(existingConfig);
    }
  }
  var src_default = FastLink;
})();
