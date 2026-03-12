/**
 * StartupInsight AI — Analytics Tracker SDK  v2.1
 * ─────────────────────────────────────────────────
 * Drop-in script for any website. Zero dependencies. ~10 KB minified.
 *
 * Usage (add to your site's <head>):
 *
 *   <script>
 *     window.SI_PROJECT_KEY = 'pk_live_YOUR_API_KEY';
 *     window.SI_ENDPOINT   = 'https://your-backend.com/track'; // omit for localhost dev
 *   </script>
 *   <script src="https://your-backend.com/tracker.js"></script>
 *
 * HTML attributes (zero JS needed):
 *   data-si-track="label"             — fires element_viewed when scrolled into view
 *   data-si-goal="goal_name"          — fires goal_triggered on click (conversion signal)
 *   data-si-goal-value="49"           — optional numeric value attached to the goal
 *
 * Public API:
 *   SI.track('event_name', { key: 'value' })       — custom event
 *   SI.identify('user_123', { plan: 'pro' })        — tie events to a user
 *   SI.setVariant('test_name', 'B')                 — A/B variant (attaches to all events)
 *   SI.trackElement('#hero-cta', 'cta_viewed')      — element visibility tracking
 *   SI.flush()                                      — force-send queued events
 *   SI.getSessionId()                               — current session ID
 *   SI.getJourney()                                 — current session page sequence
 *
 * Auto-tracked events:
 *   session_start, page_view, page_exit, click, outbound_click,
 *   scroll_depth, form_submit, form_start, form_abandon, goal_triggered,
 *   rage_click, element_viewed, video_play, video_pause, video_complete,
 *   text_copy, tab_hidden, tab_visible, js_error, page_performance
 *
 * Every click event includes:
 *   id, className, text, href, x, y, window_w, window_h, css_path
 *   css_path uniquely identifies the element even without an id.
 */
(function (window, document) {
  'use strict';

  // ── Configuration ────────────────────────────────────────────────────────────
  var ENDPOINT          = window.SI_ENDPOINT || 'http://localhost:5000/track';
  var BATCH_INTERVAL    = 3000;
  var SESSION_KEY       = 'si_session_id';
  var SCROLL_KEY        = 'si_scroll_fired';
  var USER_KEY          = 'si_user';          // localStorage — survives sessions
  var VARIANTS_KEY      = 'si_variants';      // sessionStorage — per session
  var UTM_KEY           = 'si_utm';           // sessionStorage — first-touch UTMs
  var SCROLL_MILESTONES = [25, 50, 75];
  var RAGE_THRESHOLD    = 3;    // clicks within...
  var RAGE_WINDOW_MS    = 600;  // ...this window
  var RAGE_RADIUS_PX    = 50;
  var JOURNEY_KEY       = 'si_journey'; // sessionStorage — page sequence this session

  // ── API Key ───────────────────────────────────────────────────────────────────
  var PROJECT_KEY = window.SI_PROJECT_KEY || '';
  if (!window.SI_ENDPOINT && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    console.warn('[StartupInsight AI] window.SI_ENDPOINT is not set. Tracking will fail on deployed sites. Set it to your backend URL, e.g.: window.SI_ENDPOINT = "https://your-backend.com/track"');
  }

  if (!PROJECT_KEY) {
    console.warn('[StartupInsight AI] No project key found. Set window.SI_PROJECT_KEY before loading tracker.js');
  }

  // ── Session ID ────────────────────────────────────────────────────────────────
  function generateId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  function getSessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) { id = generateId('sess'); sessionStorage.setItem(SESSION_KEY, id); }
      return id;
    } catch (e) { return generateId('sess'); }
  }

  var sessionId = getSessionId();

  // ── Session Journey ───────────────────────────────────────────────────────────
  // Tracks the ordered sequence of pages + key events within this session.
  // Used by the AI layer to understand the full path before any conversion/drop-off.
  var _journey = (function () {
    try { return JSON.parse(sessionStorage.getItem(JOURNEY_KEY)) || []; } catch (e) { return []; }
  })();

  function recordJourneyStep(type, label) {
    // Keep last 50 steps — enough context without unbounded growth
    if (_journey.length >= 50) _journey.shift();
    _journey.push({
      t:    type,              // 'page' | 'goal' | 'form_submit' | 'error'
      v:    label,             // page path or goal name
      ms:   Date.now(),
    });
    try { sessionStorage.setItem(JOURNEY_KEY, JSON.stringify(_journey)); } catch (e) {}
  }

  // ── User Identity ─────────────────────────────────────────────────────────────
  // Stored in localStorage so it persists across sessions.
  var _identity = (function () {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) || {}; } catch (e) { return {}; }
  })();

  function saveIdentity() {
    try { localStorage.setItem(USER_KEY, JSON.stringify(_identity)); } catch (e) {}
  }

  // ── A/B Variants ──────────────────────────────────────────────────────────────
  // Stored in sessionStorage — one variant per named test per session.
  var _variants = (function () {
    try { return JSON.parse(sessionStorage.getItem(VARIANTS_KEY)) || {}; } catch (e) { return {}; }
  })();

  function saveVariants() {
    try { sessionStorage.setItem(VARIANTS_KEY, JSON.stringify(_variants)); } catch (e) {}
  }

  // ── UTM / Referrer (first-touch) ─────────────────────────────────────────────
  // Captured once per session; subsequent page views don't overwrite it.
  var _utm = (function () {
    try {
      var stored = sessionStorage.getItem(UTM_KEY);
      if (stored) return JSON.parse(stored);

      var params = new URLSearchParams(window.location.search);
      var data = {
        utm_source:   params.get('utm_source')   || null,
        utm_medium:   params.get('utm_medium')   || null,
        utm_campaign: params.get('utm_campaign') || null,
        utm_term:     params.get('utm_term')     || null,
        utm_content:  params.get('utm_content')  || null,
        referrer:     document.referrer          || null,
      };
      sessionStorage.setItem(UTM_KEY, JSON.stringify(data));
      return data;
    } catch (e) { return {}; }
  })();

  // ── CSS Path Helper ───────────────────────────────────────────────────────────
  // Computes a unique CSS selector path for any element, e.g.:
  //   "main > section#pricing > .btn-group > button:nth-child(2)"
  // This lets the AI (and heatmap layer) uniquely identify elements
  // even when they share a class and have no id.
  function getCssPath(el) {
    if (!el || el === document.body) return 'body';
    var parts = [];
    var node  = el;
    var depth = 0;
    while (node && node !== document.body && depth < 6) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + node.id;
        parts.unshift(part);
        break; // id is unique — stop here
      }
      // Add class hints (first 2 meaningful classes only)
      if (node.className && typeof node.className === 'string') {
        var cls = node.className.trim().split(/\s+/).filter(function (c) {
          return c && !/^(active|hover|focus|open|show|hidden|disabled)$/.test(c);
        }).slice(0, 2);
        if (cls.length) part += '.' + cls.join('.');
      }
      // Add :nth-child if siblings exist with the same tag
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(
          parent.children,
          function (c) { return c.tagName === node.tagName; }
        );
        if (siblings.length > 1) {
          part += ':nth-child(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')';
        }
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    return parts.join(' > ').slice(0, 300);
  }

  // ── Event Queue & Flush ───────────────────────────────────────────────────────
  var queue      = [];
  var flushTimer = null;

  function buildEvent(type, extra) {
    var base = {
      projectKey: PROJECT_KEY,
      sessionId:  sessionId,
      event:      type,
      page:       window.location.pathname,
      url:        window.location.href,
      timestamp:  new Date().toISOString(),
      metadata:   {},
    };
    // Attach user identity if known
    if (_identity.userId) base.userId = _identity.userId;
    // Merge: extra can override page/url/metadata
    var evt = Object.assign(base, extra || {});
    // Always deep-merge variants into metadata (non-destructive)
    var variantKeys = Object.keys(_variants);
    if (variantKeys.length) {
      evt.metadata = Object.assign({}, evt.metadata);
      variantKeys.forEach(function (k) {
        evt.metadata['variant_' + k] = _variants[k];
      });
    }
    return evt;
  }

  function track(type, extra) {
    if (!PROJECT_KEY) return;
    queue.push(buildEvent(type, extra));
    scheduleFlush();
  }

  function scheduleFlush() {
    if (!flushTimer) flushTimer = setTimeout(flush, BATCH_INTERVAL);
  }

  function flush() {
    flushTimer = null;
    if (queue.length === 0) return;
    var batch   = queue.slice();
    queue       = [];
    var payload = JSON.stringify(batch);

    if (typeof navigator.sendBeacon === 'function') {
      var blob = new Blob([payload], { type: 'application/json' });
      if (!navigator.sendBeacon(ENDPOINT, blob)) sendViaFetch(payload);
    } else {
      sendViaFetch(payload);
    }
  }

  function sendViaFetch(payload) {
    fetch(ENDPOINT, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      payload,
      keepalive: true,
    }).catch(function () {});
  }

  // Periodic safety-net flush
  setInterval(flush, BATCH_INTERVAL);

  // ── Auto-tracked Events ───────────────────────────────────────────────────────

  // 1. Session start — once per session, includes first-touch UTMs + referrer
  track('session_start', {
    metadata: Object.assign({}, _utm, {
      screen_w: window.screen.width,
      screen_h: window.screen.height,
      lang:     navigator.language || null,
      tz:       Intl && Intl.DateTimeFormat
                  ? Intl.DateTimeFormat().resolvedOptions().timeZone
                  : null,
    }),
  });

  // 2. Page view — helper used for initial load and SPA navigation
  var _pageViewedAt = Date.now();
  var _sessionPageCount = 0;

  function trackPageView() {
    _pageViewedAt = Date.now();
    _sessionPageCount++;
    recordJourneyStep('page', window.location.pathname);
    track('page_view', {
      metadata: {
        referrer:          document.referrer || null,
        utm_source:        _utm.utm_source   || null,
        utm_medium:        _utm.utm_medium   || null,
        utm_campaign:      _utm.utm_campaign || null,
        session_page_num:  _sessionPageCount, // which page in the session (1 = entry)
        journey_so_far:    _journey.slice(-10).map(function (s) { return s.v; }), // last 10 steps
      },
    });
  }
  trackPageView();

  // 3. Page exit — fires on tab/window close; reports actual time on page
  window.addEventListener('pagehide', function () {
    track('page_exit', {
      metadata: { time_on_page_ms: Date.now() - _pageViewedAt },
    });
    flush();
  });
  window.addEventListener('beforeunload', flush);

  // 4. Click tracking — rage-click detection + outbound link detection
  var _recentClicks = []; // { x, y, t }

  document.addEventListener(
    'click',
    function (e) {
      var target = e.target;
      var depth  = 0;
      while (target && target !== document.body && depth < 4) {
        if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(target.tagName)) break;
        target = target.parentElement;
        depth++;
      }
      if (!target) target = e.target;

      var now = Date.now();
      var cx  = Math.round(e.clientX);
      var cy  = Math.round(e.clientY);

      // Common click metadata — css_path uniquely identifies the element for AI & heatmaps
      var clickMeta = {
        id:          target.id                                            || null,
        className:   typeof target.className === 'string'
                       ? target.className.trim().slice(0, 100)           : null,
        text:        (target.innerText || target.value || '').trim().slice(0, 150),
        href:        target.href                                          || null,
        css_path:    getCssPath(target),
        x:           cx,
        y:           cy,
        window_w:    window.innerWidth,
        window_h:    window.innerHeight,
        // Journey context: what pages did the user visit before this click?
        journey:     _journey.slice(-5).map(function (s) { return s.v; }),
      };

      // Outbound click detection
      var href = target.href || (target.closest ? (target.closest('a') || {}).href : null);
      var isOutbound = href &&
        href.indexOf('http') === 0 &&
        href.indexOf(window.location.hostname) === -1;

      if (isOutbound) {
        track('outbound_click', {
          element:  target.tagName,
          metadata: Object.assign({}, clickMeta, { destination: href.slice(0, 300) }),
        });
      }

      track('click', { element: target.tagName, metadata: clickMeta });

      // data-si-goal: fires a dedicated goal_triggered event.
      // This is the definitive conversion signal for the AI layer —
      // no inference needed, the developer explicitly marks conversion points.
      // Example: <button data-si-goal="signup_intent" data-si-goal-value="0">
      var goalEl = target.hasAttribute && target.hasAttribute('data-si-goal')
        ? target
        : (target.closest ? target.closest('[data-si-goal]') : null);

      if (goalEl) {
        var goalName  = goalEl.getAttribute('data-si-goal');
        var goalValue = goalEl.getAttribute('data-si-goal-value');
        recordJourneyStep('goal', goalName);
        track('goal_triggered', {
          element: goalEl.tagName,
          metadata: {
            goal_name:   goalName,
            goal_value:  goalValue !== null ? Number(goalValue) : null,
            // Full element identity so AI knows exactly what was clicked
            id:          goalEl.id       || null,
            text:        (goalEl.innerText || goalEl.value || '').trim().slice(0, 150),
            css_path:    getCssPath(goalEl),
            page:        window.location.pathname,
            // Journey leading up to this conversion — key for funnel AI analysis
            journey:     _journey.slice(-10).map(function (s) { return { t: s.t, v: s.v }; }),
            // Time spent on current page before converting
            time_on_page_ms: Date.now() - _pageViewedAt,
          },
        });
      }

      // Rage-click: 3+ clicks within RAGE_WINDOW_MS in RAGE_RADIUS_PX
      _recentClicks.push({ x: cx, y: cy, t: now });
      _recentClicks = _recentClicks.filter(function (c) { return now - c.t < RAGE_WINDOW_MS; });

      if (_recentClicks.length >= RAGE_THRESHOLD) {
        var allClose = _recentClicks.every(function (c) {
          return Math.abs(c.x - cx) < RAGE_RADIUS_PX && Math.abs(c.y - cy) < RAGE_RADIUS_PX;
        });
        if (allClose) {
          track('rage_click', {
            element:  target.tagName,
            metadata: Object.assign({}, clickMeta, { click_count: _recentClicks.length }),
          });
          _recentClicks = []; // reset so we don't fire multiple times
        }
      }
    },
    { passive: true }
  );

  // 5. Scroll depth — fires once per milestone per page
  var scrollFired = (function () {
    try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY)) || {}; } catch (e) { return {}; }
  })();

  function saveScrollState() {
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scrollFired)); } catch (e) {}
  }

  function getScrollPercent() {
    var scrollTop  = window.pageYOffset || document.documentElement.scrollTop || 0;
    var docHeight  = Math.max(
      document.body.scrollHeight, document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
    var scrollable = docHeight - window.innerHeight;
    if (scrollable <= 0) return 100;
    return Math.min(100, Math.round((scrollTop / scrollable) * 100));
  }

  var scrollTimeout = null;
  window.addEventListener('scroll', function () {
    if (scrollTimeout) return;
    scrollTimeout = setTimeout(function () {
      scrollTimeout = null;
      var pct = getScrollPercent();
      SCROLL_MILESTONES.forEach(function (milestone) {
        if (pct >= milestone && !scrollFired[milestone]) {
          scrollFired[milestone] = true;
          saveScrollState();
          track('scroll_depth', { metadata: { depth_percent: milestone } });
        }
      });
    }, 200);
  }, { passive: true });

  // 6. Form tracking — start, submit, abandon
  var _activeForms = {}; // formKey → { startedAt, fieldCount }

  function getFormKey(form) {
    return form.id || form.name || form.action || 'form_' + Array.prototype.indexOf.call(
      document.querySelectorAll('form'), form
    );
  }

  // form_start: first focus on any field inside a form
  document.addEventListener('focusin', function (e) {
    var form = e.target && e.target.form;
    if (!form) return;
    var key = getFormKey(form);
    if (!_activeForms[key]) {
      _activeForms[key] = { startedAt: Date.now() };
      track('form_start', {
        element: 'FORM',
        metadata: {
          formId:     form.id     || null,
          formName:   form.name   || null,
          formAction: form.action || null,
        },
      });
    }
  }, { passive: true });

  // form_submit
  document.addEventListener('submit', function (e) {
    var form    = e.target;
    var key     = getFormKey(form);
    var started = _activeForms[key];
    recordJourneyStep('form_submit', form.id || form.name || form.action || 'form');
    track('form_submit', {
      element: 'FORM',
      metadata: {
        formId:            form.id     || null,
        formName:          form.name   || null,
        formAction:        form.action || null,
        formMethod:        (form.method || 'get').toUpperCase(),
        css_path:          getCssPath(form),
        time_to_submit_ms: started ? Date.now() - started.startedAt : null,
        journey:           _journey.slice(-5).map(function (s) { return s.v; }),
      },
    });
    delete _activeForms[key]; // no abandon after successful submit
  }, { passive: true });

  // form_abandon: started but page leaves without submit
  window.addEventListener('pagehide', function () {
    Object.keys(_activeForms).forEach(function (key) {
      var parts = key.split('_');
      track('form_abandon', {
        element: 'FORM',
        metadata: { formKey: key, time_spent_ms: Date.now() - _activeForms[key].startedAt },
      });
    });
  });

  // 7. SPA navigation — patch history API
  (function patchHistory() {
    var _push    = history.pushState;
    var _replace = history.replaceState;

    function onNav() {
      scrollFired = {};
      saveScrollState();
      _activeForms = {};
      trackPageView();
    }

    history.pushState = function () { _push.apply(history, arguments); onNav(); };
    history.replaceState = function () { _replace.apply(history, arguments); onNav(); };
    window.addEventListener('popstate', onNav);
  })();

  // 8. Error tracking — JS errors + unhandled promise rejections
  window.addEventListener('error', function (e) {
    recordJourneyStep('error', (e.message || 'js_error').slice(0, 60));
    track('js_error', {
      metadata: {
        message:  (e.message  || '').slice(0, 300),
        filename: (e.filename || '').slice(0, 200),
        lineno:   e.lineno  || null,
        colno:    e.colno   || null,
        stack:    (e.error && e.error.stack ? e.error.stack.slice(0, 500) : null),
        // Journey up to the error — shows what user did before it crashed
        journey:  _journey.slice(-10).map(function (s) { return { t: s.t, v: s.v }; }),
      },
    });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var msg = '';
    if (e.reason) {
      msg = (e.reason.message || String(e.reason) || '').slice(0, 300);
    }
    track('js_error', {
      metadata: {
        message: msg,
        type:    'unhandled_rejection',
        stack:   (e.reason && e.reason.stack ? e.reason.stack.slice(0, 500) : null),
      },
    });
  });

  // 9. Tab visibility — hidden / visible
  document.addEventListener('visibilitychange', function () {
    track(document.hidden ? 'tab_hidden' : 'tab_visible', {
      metadata: { time_on_page_ms: Date.now() - _pageViewedAt },
    });
  });

  // 10. Text copy
  document.addEventListener('copy', function () {
    var sel = window.getSelection ? window.getSelection() : null;
    var text = sel ? sel.toString().trim().slice(0, 200) : '';
    track('text_copy', { metadata: { copied_text: text || null } });
  }, { passive: true });

  // 11. Video tracking — attaches to all <video> elements (including future ones)
  function attachVideoTracking(video) {
    if (video._si_tracked) return;
    video._si_tracked = true;

    var src = (video.src || video.currentSrc || '').slice(0, 200);

    function videoMeta(extra) {
      return Object.assign({
        src:              src || null,
        duration:         isFinite(video.duration) ? Math.round(video.duration) : null,
        current_time:     Math.round(video.currentTime || 0),
        percent_watched:  isFinite(video.duration) && video.duration > 0
                            ? Math.round((video.currentTime / video.duration) * 100)
                            : null,
      }, extra || {});
    }

    video.addEventListener('play',  function () { track('video_play',  { metadata: videoMeta() }); });
    video.addEventListener('pause', function () {
      // Filter out the pause that fires right before 'ended'
      if (!video.ended) track('video_pause', { metadata: videoMeta() });
    });
    video.addEventListener('ended', function () { track('video_complete', { metadata: videoMeta() }); });
  }

  // Attach to all current videos
  Array.prototype.forEach.call(document.querySelectorAll('video'), attachVideoTracking);

  // Attach to future videos added dynamically
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.tagName === 'VIDEO') attachVideoTracking(node);
          Array.prototype.forEach.call(node.querySelectorAll('video'), attachVideoTracking);
        });
      });
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // 12. Element visibility tracking — opt-in via data-si-track="label"
  //     Also used by the public SI.trackElement() API
  var _trackedElements = {}; // selector → label

  function setupElementObserver() {
    if (typeof IntersectionObserver === 'undefined') return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el    = entry.target;
        var label = el.getAttribute('data-si-track') || el._si_label || el.id || el.tagName;
        track('element_viewed', {
          element: el.tagName,
          metadata: {
            label:     label,
            id:        el.id        || null,
            className: typeof el.className === 'string' ? el.className.trim().slice(0, 100) : null,
          },
        });
        io.unobserve(el); // fire once per element per page load
      });
    }, { threshold: 0.5 }); // at least 50% in view

    // Attach to all [data-si-track] elements
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-si-track]'),
      function (el) { io.observe(el); }
    );

    // Watch for new [data-si-track] elements added dynamically
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          m.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;
            if (node.hasAttribute && node.hasAttribute('data-si-track')) io.observe(node);
            Array.prototype.forEach.call(
              node.querySelectorAll ? node.querySelectorAll('[data-si-track]') : [],
              function (el) { io.observe(el); }
            );
          });
        });
      }).observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    return io;
  }

  var _io = setupElementObserver();

  // 13. Page performance — fires once after load using Navigation Timing API
  function trackPerformance() {
    try {
      var nav = performance.getEntriesByType('navigation')[0]
              || performance.timing; // fallback for older browsers
      if (!nav) return;

      // PerformanceNavigationTiming (modern)
      if (nav.responseStart !== undefined && nav.fetchStart !== undefined && nav.fetchStart > 0) {
        track('page_performance', {
          metadata: {
            ttfb_ms:       Math.round(nav.responseStart      - nav.fetchStart),
            dom_load_ms:   Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
            page_load_ms:  Math.round(nav.loadEventEnd       - nav.fetchStart),
            transfer_kb:   nav.transferSize ? Math.round(nav.transferSize / 1024) : null,
          },
        });
      }
    } catch (e) {}
  }

  if (document.readyState === 'complete') {
    trackPerformance();
  } else {
    window.addEventListener('load', trackPerformance, { once: true });
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.StartupInsightAI = {
    /**
     * Manually track a custom event.
     *   SI.track('upgrade_clicked', { plan: 'pro', source: 'banner' });
     */
    track: function (eventName, metadata) {
      if (!eventName || typeof eventName !== 'string') {
        console.warn('[StartupInsight AI] track() requires an event name string');
        return;
      }
      track(eventName, { metadata: metadata || {} });
    },

    /**
     * Identify the current user. Call after login/signup.
     *   SI.identify('user_123', { plan: 'pro', name: 'Alice' });
     * The userId and traits are stored in localStorage and attached to all
     * subsequent events automatically.
     */
    identify: function (userId, traits) {
      if (!userId) return;
      _identity = Object.assign(_identity, { userId: String(userId) }, traits || {});
      saveIdentity();
      track('identify', {
        userId:   String(userId),
        metadata: Object.assign({ userId: String(userId) }, traits || {}),
      });
    },

    /**
     * Set an A/B test variant for this session.
     * The variant is automatically appended to all subsequent event metadata.
     *   SI.setVariant('homepage_hero', 'B');
     *   // → all events get metadata.variant_homepage_hero = 'B'
     */
    setVariant: function (testName, variantValue) {
      if (!testName) return;
      _variants[String(testName)] = String(variantValue);
      saveVariants();
    },

    /**
     * Track when a specific element becomes visible in the viewport.
     * Fires once per element per page load.
     *   SI.trackElement('#hero-cta', 'hero_cta_viewed');
     *   SI.trackElement('.pricing-section', 'pricing_viewed');
     */
    trackElement: function (selector, label) {
      if (!selector || typeof IntersectionObserver === 'undefined') return;
      var els = document.querySelectorAll(selector);
      if (!els.length) {
        console.warn('[StartupInsight AI] trackElement: no elements match "' + selector + '"');
        return;
      }
      if (!_io) _io = setupElementObserver();
      Array.prototype.forEach.call(els, function (el) {
        el._si_label = label || selector;
        _io.observe(el);
      });
    },

    /** Force-flush the event queue immediately. */
    flush: flush,

    /** Returns the current session ID. */
    getSessionId: function () { return sessionId; },

    /** Returns the current identified user (if any). */
    getUser: function () { return Object.assign({}, _identity); },

    /**
     * Returns the current session journey — ordered list of pages, goals,
     * form submissions and errors in this session. Used by the AI layer
     * to reconstruct the full user path for funnel/conversion analysis.
     *
     * Example output:
     *   [ { t: 'page', v: '/' },
     *     { t: 'page', v: '/pricing' },
     *     { t: 'goal', v: 'hero_cta_clicked' },
     *     { t: 'page', v: '/signup' },
     *     { t: 'form_submit', v: 'signup-form' } ]
     */
    getJourney: function () { return _journey.slice(); },
  };

  console.log('[StartupInsight AI] Tracker v2.1 initialized. Session:', sessionId);

}(window, document));
