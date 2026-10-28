/**
 * FastLink Universal Browser Runtime v0.1.0
 * Starts eligible same-origin navigation on primary mouse pointerdown (~85ms earlier than click).
 * Preserves native gestures, modifiers, downloads, and keyboard clicks.
 * Cleanly suppresses duplicate follow-up clicks while preserving custom handlers and telemetry.
 */
(function(window, document) {
  'use strict';

  if (!window || !document || window.__FAST_LINK_INITIALIZED__) return;
  window.__FAST_LINK_INITIALIZED__ = true;

  var HANDLED_EVENTS = new WeakSet();
  var SUPPRESSED_CLICKS = new WeakSet();
  var NESTED_TAGS = { BUTTON: 1, INPUT: 1, LABEL: 1, SELECT: 1, SUMMARY: 1, TEXTAREA: 1 };
  var BUTTON_ROLE_REGEX = /(?:^|[\t\n\f\r ])button(?:$|[\t\n\f\r ])/i;
  var LINK_ROLE_REGEX = /^[\t\n\f\r ]*(?:link)?[\t\n\f\r ]*$/i;

  var pendingAnchor = null;
  var pressTimestamp = 0;
  var telemetryEndpoint = window.__FAST_LINK_TELEMETRY__ || '/api/v1/telemetry';

  function findAnchor(target, boundary) {
    var el = target instanceof Element ? target : (target ? target.parentElement : null);
    while (el && el !== boundary) {
      if (el.tagName === 'A' && el.hasAttribute('href')) return el;
      el = el.parentElement;
    }
    return (el && el.tagName === 'A' && el.hasAttribute('href')) ? el : null;
  }

  function isOptedOut(target, anchor) {
    if (anchor.hasAttribute('data-no-fast-link')) return true;
    var role = anchor.getAttribute('role');
    if (role && !LINK_ROLE_REGEX.test(role)) return true;

    var el = target instanceof Element ? target : null;
    while (el && el !== anchor) {
      if (el.hasAttribute('data-no-fast-link')) return true;
      if (NESTED_TAGS[el.tagName]) return true;
      var elRole = el.getAttribute('role');
      if (elRole && BUTTON_ROLE_REGEX.test(elRole)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function resolveEligibility(event, anchor) {
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

    if (isOptedOut(event.target, anchor)) return null;

    var targetAttr = anchor.getAttribute('target');
    if (targetAttr && targetAttr !== '_self') return null;
    if (anchor.hasAttribute('download')) return null;

    var href = anchor.getAttribute('href');
    if (!href || href.charAt(0) === '#') return null;

    try {
      var resolved = new URL(href, document.baseURI);
      if (resolved.origin !== window.location.origin) return null;
      return { anchor: anchor, href: href, url: resolved };
    } catch (e) {
      return null;
    }
  }

  function sendTelemetry(data) {
    try {
      var payload = JSON.stringify(data);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(telemetryEndpoint, payload);
      } else {
        fetch(telemetryEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function() {});
      }
    } catch (e) {}
  }

  function onPointerDown(event) {
    pendingAnchor = null;
    pressTimestamp = 0;

    var anchor = findAnchor(event.target, document.body);
    if (!anchor) return;

    var intent = resolveEligibility(event, anchor);
    if (!intent) return;

    HANDLED_EVENTS.add(event);
    pendingAnchor = anchor;
    pressTimestamp = Date.now();

    // Trigger speculative prefetch or router navigation
    var prefetchUrl = '/api/v1/prefetch?url=' + encodeURIComponent(intent.url.href);
    try {
      fetch(prefetchUrl, { priority: 'high' }).catch(function() {});
    } catch (e) {}

    // Synchronous early navigation (document or SPA router hook)
    if (typeof window.__FAST_LINK_NAVIGATE__ === 'function') {
      window.__FAST_LINK_NAVIGATE__(intent);
    } else {
      window.location.assign(intent.url.href);
    }
  }

  function onClickCapture(event) {
    if (event.detail === 0) return; // Keyboard navigation (Enter key) passes through

    if (SUPPRESSED_CLICKS.has(event)) {
      event.preventDefault();
      return;
    }

    if (pendingAnchor) {
      var clickAnchor = findAnchor(event.target, document.body);
      if (clickAnchor === pendingAnchor) {
        SUPPRESSED_CLICKS.add(event);
        event.preventDefault();

        var holdDuration = pressTimestamp > 0 ? (Date.now() - pressTimestamp) : 0;
        sendTelemetry({
          source_path: window.location.pathname,
          destination_path: pendingAnchor.pathname || pendingAnchor.getAttribute('href'),
          press_duration_ms: holdDuration,
          click_suppressed: true,
          was_aborted: false
        });

        pendingAnchor = null;
        pressTimestamp = 0;
      }
    }
  }

  function onPointerUp(event) {
    if (pendingAnchor && event.target && !pendingAnchor.contains(event.target)) {
      // User pressed and dragged away before release -> aborted
      var holdDuration = pressTimestamp > 0 ? (Date.now() - pressTimestamp) : 0;
      sendTelemetry({
        source_path: window.location.pathname,
        destination_path: pendingAnchor.pathname || pendingAnchor.getAttribute('href'),
        press_duration_ms: holdDuration,
        click_suppressed: false,
        was_aborted: true
      });
      pendingAnchor = null;
      pressTimestamp = 0;
    }
  }

  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  document.addEventListener('click', onClickCapture, { capture: true });
  document.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });

})(typeof window !== 'undefined' ? window : null, typeof document !== 'undefined' ? document : null);
