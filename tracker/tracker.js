/**
 * StartupInsight AI — Analytics Tracker SDK  v1.0
 * ─────────────────────────────────────────────────
 * Drop-in script for any website. Zero dependencies. ~3 KB minified.
 *
 * Usage (add to your site's <head>):
 *
 *   <script>window.SI_PROJECT_KEY = 'pk_live_YOUR_API_KEY';</script>
 *   <script src="http://localhost:5000/tracker.js"></script>
 *
 * Manual event tracking (optional):
 *   window.StartupInsightAI.track('upgrade_clicked', { plan: 'pro' });
 */
(function (window, document) {
  'use strict';

  // ── Configuration ────────────────────────────────────────────────────────────
  var ENDPOINT        = 'http://localhost:5000/track';
  var BATCH_INTERVAL  = 3000;           // ms — how often to flush the queue
  var SESSION_KEY     = 'si_session_id';
  var SCROLL_KEY      = 'si_scroll_fired'; // sessionStorage key for scroll milestones
  var SCROLL_MILESTONES = [25, 50, 75];

  // ── API Key ───────────────────────────────────────────────────────────────────
  var PROJECT_KEY = window.SI_PROJECT_KEY || '';

  if (!PROJECT_KEY) {
    console.warn('[StartupInsight AI] No project key found. Set window.SI_PROJECT_KEY before loading tracker.js');
  }

  // ── Session ID ────────────────────────────────────────────────────────────────
  // Persists across page reloads within the same browser.
  // New session each time the user closes + reopens the browser.
  function generateId() {
    return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  function getSessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = generateId();
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      // sessionStorage blocked (strict incognito) — fall back to in-memory
      return generateId();
    }
  }

  var sessionId = getSessionId();

  // ── Event Queue & Flush ───────────────────────────────────────────────────────
  var queue      = [];
  var flushTimer = null;

  /**
   * Build a normalised event payload ready for the backend.
   */
  function buildEvent(type, extra) {
    return Object.assign(
      {
        projectKey: PROJECT_KEY,
        sessionId:  sessionId,
        event:      type,
        page:       window.location.pathname,
        url:        window.location.href,
        timestamp:  new Date().toISOString(),
        metadata:   {},
      },
      extra || {}
    );
  }

  /** Push an event onto the queue and schedule a flush. */
  function track(type, extra) {
    if (!PROJECT_KEY) return; // silently drop if not configured
    queue.push(buildEvent(type, extra));
    scheduleFlush();
  }

  function scheduleFlush() {
    if (!flushTimer) {
      flushTimer = setTimeout(flush, BATCH_INTERVAL);
    }
  }

  /**
   * Send all queued events to the backend in a single HTTP request.
   * Uses sendBeacon when available (non-blocking, survives page unload).
   */
  function flush() {
    flushTimer = null;
    if (queue.length === 0) return;

    var batch   = queue.slice();
    queue       = [];
    var payload = JSON.stringify(batch);

    if (typeof navigator.sendBeacon === 'function') {
      var blob = new Blob([payload], { type: 'application/json' });
      var sent = navigator.sendBeacon(ENDPOINT, blob);
      if (!sent) {
        // sendBeacon failed (e.g. queue too large) — fall back to fetch
        sendViaFetch(payload);
      }
    } else {
      sendViaFetch(payload);
    }
  }

  function sendViaFetch(payload) {
    fetch(ENDPOINT, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      payload,
      keepalive: true,   // allows request to outlive page unload
    }).catch(function () {
      // Silently swallow network errors — never throw on the host page
    });
  }

  // Flush on page leave (covers tab close, navigation, refresh)
  window.addEventListener('pagehide',     flush);
  window.addEventListener('beforeunload', flush);

  // Periodic flush as a safety net (catches slow pages that never unload)
  setInterval(flush, BATCH_INTERVAL);

  // ── Auto-tracked Events ───────────────────────────────────────────────────────

  // 1. Session start (once per session — only fires on first page load)
  track('session_start');

  // 2. Page view
  track('page_view');

  // 3. Click tracking — captures any interactive element
  document.addEventListener(
    'click',
    function (e) {
      var target = e.target;

      // Walk up DOM to find the most meaningful ancestor (handles icon-inside-button)
      var depth = 0;
      while (target && target !== document.body && depth < 4) {
        if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(target.tagName)) break;
        target = target.parentElement;
        depth++;
      }
      if (!target) target = e.target;

      track('click', {
        element: target.tagName,
        metadata: {
          id:        target.id                                             || null,
          className: typeof target.className === 'string'
                       ? target.className.trim().slice(0, 100)            : null,
          text:      (target.innerText || target.value || '').trim().slice(0, 150),
          href:      target.href                                           || null,
          // Click coordinates for heatmap support (future feature)
          x:         Math.round(e.clientX),
          y:         Math.round(e.clientY),
        },
      });
    },
    { passive: true }
  );

  // 4. Scroll depth — fires once per milestone per session
  var scrollFired = (function () {
    try {
      var stored = sessionStorage.getItem(SCROLL_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  })();

  function saveScrollState() {
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scrollFired)); } catch (e) {}
  }

  function getScrollPercent() {
    var scrollTop  = window.pageYOffset || document.documentElement.scrollTop || 0;
    var docHeight  = Math.max(
      document.body.scrollHeight,    document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
    var viewHeight = window.innerHeight;
    var scrollable = docHeight - viewHeight;
    if (scrollable <= 0) return 100;
    return Math.min(100, Math.round((scrollTop / scrollable) * 100));
  }

  // Debounce scroll handler — fires at most once per 200ms
  var scrollTimeout = null;
  window.addEventListener(
    'scroll',
    function () {
      if (scrollTimeout) return;
      scrollTimeout = setTimeout(function () {
        scrollTimeout = null;
        var pct = getScrollPercent();
        SCROLL_MILESTONES.forEach(function (milestone) {
          if (pct >= milestone && !scrollFired[milestone]) {
            scrollFired[milestone] = true;
            saveScrollState();
            track('scroll_depth', {
              metadata: { depth_percent: milestone },
            });
          }
        });
      }, 200);
    },
    { passive: true }
  );

  // 5. Form submission tracking
  document.addEventListener(
    'submit',
    function (e) {
      var form = e.target;
      track('form_submit', {
        element: 'FORM',
        metadata: {
          formId:     form.id         || null,
          formName:   form.name       || null,
          formAction: form.action     || null,
          formMethod: (form.method || 'get').toUpperCase(),
        },
      });
    },
    { passive: true }
  );

  // 6. SPA navigation — patch history API so React/Vue/Next apps auto-track routes
  (function patchHistory() {
    var _push    = history.pushState;
    var _replace = history.replaceState;

    history.pushState = function () {
      _push.apply(history, arguments);
      // Reset scroll milestones on new page
      scrollFired = {};
      saveScrollState();
      track('page_view');
    };

    history.replaceState = function () {
      _replace.apply(history, arguments);
      scrollFired = {};
      saveScrollState();
      track('page_view');
    };

    window.addEventListener('popstate', function () {
      scrollFired = {};
      saveScrollState();
      track('page_view');
    });
  })();

  // ── Public API ────────────────────────────────────────────────────────────────
  window.StartupInsightAI = {
    /**
     * Manually track a custom event.
     *
     * @param {string} eventName   - e.g. 'upgrade_clicked', 'video_played'
     * @param {object} [metadata]  - key/value pairs to store with the event
     *
     * Example:
     *   window.StartupInsightAI.track('cta_clicked', { plan: 'pro', source: 'landing' });
     */
    track: function (eventName, metadata) {
      if (!eventName || typeof eventName !== 'string') {
        console.warn('[StartupInsight AI] track() requires an event name string');
        return;
      }
      track(eventName, { metadata: metadata || {} });
    },

    /** Force-flush the queue immediately (useful before programmatic navigation). */
    flush: flush,

    /** Returns the current session ID. */
    getSessionId: function () { return sessionId; },
  };

  console.log('[StartupInsight AI] Tracker initialized. Session:', sessionId);

}(window, document));
