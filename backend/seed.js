'use strict';
/**
 * Seed script — injects realistic fake analytics data for a given API key.
 * Usage:  node seed.js
 */
require('dotenv').config();
const http = require('http');

const API_KEY = 'pk_live_cae493b25261ee0c97e8fc607a51b8e59ab7f6736d5aea9b';
const BASE    = 'http://localhost:5000';

// ── Helpers ────────────────────────────────────────────────────────────────
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr)          { return arr[Math.floor(Math.random() * arr.length)]; }

function isoAgo(daysAgo, hourOffset = 0) {
  const d = new Date(Date.now() - daysAgo * 86400000 - hourOffset * 3600000);
  return d.toISOString();
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Data fixtures ──────────────────────────────────────────────────────────
const PAGES = ['/', '/pricing', '/features', '/blog', '/about', '/signup', '/login', '/dashboard', '/docs', '/contact'];
const FUNNEL_PAGES = ['/', '/pricing', '/signup', '/dashboard'];
const EVENTS = ['page_view', 'page_view', 'page_view', 'click', 'click', 'scroll_depth', 'js_error', 'goal_triggered', 'page_view', 'click'];
const ELEMENTS = ['button', 'a', 'div', 'input', 'img'];
const CLICK_TEXTS = ['Get started', 'View pricing', 'Sign up free', 'Learn more', 'Contact us', 'Start trial', 'Book demo', 'Read more'];
const GOAL_NAMES = ['signup_completed', 'upgrade_clicked', 'demo_booked', 'checkout_started'];
const USER_IDS = [null, null, null, 'user_alice@example.com', 'user_bob@example.com', 'user_charlie@example.com', 'user_diana@example.com', 'user_eve@example.com'];
const VARIANTS = ['control', 'variant_a', 'variant_b'];
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Firefox/124.0',
];

// ── Build events ───────────────────────────────────────────────────────────
function buildSession(daysAgo) {
  const sessionId = uuid();
  const userId    = pick(USER_IDS);
  const variant   = Math.random() < 0.4 ? pick(VARIANTS) : null;
  const eventList = [];

  // Each session: 3-12 page views + clicks
  const pageCount = randInt(3, 12);
  let hourOffset  = randInt(0, 20);

  // Simulate funnel traversal (30% sessions follow the full funnel)
  const followFunnel = Math.random() < 0.3;
  const pages = followFunnel
    ? FUNNEL_PAGES.slice(0, randInt(2, 4))
    : Array.from({ length: pageCount }, () => pick(PAGES));

  for (const page of pages) {
    const ts = isoAgo(daysAgo, hourOffset);
    hourOffset = Math.max(0, hourOffset - Math.random() * 0.5);

    // page_view
    eventList.push({
      sessionId, userId,
      event: 'page_view',
      page, url: 'https://myapp.example.com' + page,
      metadata: variant ? { variant } : {},
      timestamp: ts,
    });

    // 60% chance of a click on this page
    if (Math.random() < 0.6) {
      // Simulate realistic click coordinates within a 1280x800 viewport
      // Cluster around typical CTA zones: top nav, hero, mid-page buttons
      const zones = [
        { x: [120, 320], y: [60, 120] },    // top nav links
        { x: [400, 800], y: [180, 320] },   // hero / above fold CTA
        { x: [300, 900], y: [350, 550] },   // mid-page content
        { x: [500, 750], y: [600, 720] },   // footer CTAs
      ];
      const zone = pick(zones);
      const cx = randInt(zone.x[0], zone.x[1]);
      const cy = randInt(zone.y[0], zone.y[1]);
      const vw = pick([1280, 1440, 1920, 768, 375]);
      const vh = pick([800, 900, 1080, 1024, 667]);
      eventList.push({
        sessionId, userId,
        event: 'click',
        page, url: 'https://myapp.example.com' + page,
        element: pick(ELEMENTS),
        metadata: {
          text: pick(CLICK_TEXTS),
          x: Math.round(cx * vw / 1280),
          y: Math.round(cy * vh / 800),
          window_w: vw,
          window_h: vh,
          ...(variant ? { variant } : {}),
        },
        timestamp: isoAgo(daysAgo, hourOffset - 0.01),
      });
    }

    // 40% chance of scroll_depth
    if (Math.random() < 0.4) {
      eventList.push({
        sessionId, userId,
        event: 'scroll_depth',
        page, url: 'https://myapp.example.com' + page,
        metadata: { depth: pick([25, 50, 75, 90, 100]) },
        timestamp: isoAgo(daysAgo, hourOffset - 0.02),
      });
    }

    // 5% chance of js_error
    if (Math.random() < 0.05) {
      eventList.push({
        sessionId, userId,
        event: 'js_error',
        page,
        metadata: { message: pick(['TypeError: Cannot read property', 'ReferenceError: foo is not defined', 'NetworkError: Failed to fetch']), stack: 'Error at app.js:123' },
        timestamp: isoAgo(daysAgo, hourOffset - 0.03),
      });
    }
  }

  // 20% chance of goal conversion at the end of a session
  if (Math.random() < 0.2) {
    const goalName = pick(GOAL_NAMES);
    eventList.push({
      sessionId, userId,
      event: 'goal_triggered',
      page: pages[pages.length - 1],
      metadata: { goal_name: goalName, ...(variant ? { variant } : {}) },
      timestamp: isoAgo(daysAgo, Math.max(0, hourOffset - 0.1)),
    });
  }

  return eventList;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nSeeding fake data for API key: ${API_KEY}\n`);

  // Generate 90 days of sessions — heavier recent traffic
  const allEvents = [];
  for (let day = 90; day >= 0; day--) {
    // More sessions on recent days (simulate growth)
    const sessionCount = day < 7  ? randInt(8, 20)
                       : day < 30 ? randInt(3, 10)
                       :             randInt(1, 5);
    for (let s = 0; s < sessionCount; s++) {
      allEvents.push(...buildSession(day));
    }
  }

  console.log(`Generated ${allEvents.length} events across sessions`);

  // Batch-send in chunks of 50
  const chunkSize = 50;
  let sent = 0;
  let errors = 0;

  for (let i = 0; i < allEvents.length; i += chunkSize) {
    const chunk = allEvents.slice(i, i + chunkSize).map(e => ({ ...e, projectKey: API_KEY }));

    try {
      // Body must be a flat array of event objects; projectKey inside each item
      const res = await post('/track', chunk);
      if (res.status === 202) {
        sent += chunk.length;
      } else {
        console.error(`  Chunk ${i}-${i + chunkSize}: HTTP ${res.status} — ${res.body}`);
        errors++;
      }
    } catch (err) {
      console.error(`  Chunk ${i}-${i + chunkSize}: ${err.message}`);
      errors++;
    }

    // Progress
    if ((i / chunkSize) % 10 === 0) {
      process.stdout.write(`  Progress: ${sent}/${allEvents.length} events sent...\r`);
    }
  }

  console.log(`\n✓ Done! Sent ${sent} events. Errors: ${errors}`);

  // ── Seed goals & funnels directly via DB ─────────────────────────────────
  console.log('\nSeeding goals and funnels...');
  const db      = require('./db');
  const crypto  = require('crypto');
  await db.init();

  const project = db.get('SELECT id FROM projects WHERE api_key = ?', [API_KEY]);
  if (!project) { console.error('Project not found, skipping goals/funnels.'); return; }
  const pid = project.id;

  const GOALS = [
    { name: 'CTA Click (Pricing)',  event_name: 'goal_triggered', conditions: { goal_name: 'cta_click' } },
    { name: 'Signup Completed',     event_name: 'goal_triggered', conditions: { goal_name: 'signup_completed' } },
    { name: 'Demo Booked',          event_name: 'goal_triggered', conditions: { goal_name: 'demo_booked' } },
    { name: 'Upgrade Clicked',      event_name: 'goal_triggered', conditions: { goal_name: 'upgrade_clicked' } },
  ];

  const FUNNELS = [
    { name: 'Acquisition → Signup',          steps: ['/', '/pricing', '/signup'] },
    { name: 'Blog → Discovery → Conversion', steps: ['/blog', '/features', '/pricing', '/signup'] },
    { name: 'Trial Activation',              steps: ['/signup', '/dashboard', '/docs'] },
  ];

  const now7 = new Date(Date.now() - 7 * 86400000).toISOString();

  GOALS.forEach(g => {
    try {
      db.run(
        'INSERT OR IGNORE INTO goals (id,project_id,name,event_name,conditions,created_at) VALUES (?,?,?,?,?,?)',
        [crypto.randomUUID(), pid, g.name, g.event_name, JSON.stringify(g.conditions), now7]
      );
    } catch (_) {}
  });

  FUNNELS.forEach(f => {
    try {
      db.run(
        'INSERT OR IGNORE INTO funnels (id,project_id,name,steps,created_at) VALUES (?,?,?,?,?)',
        [crypto.randomUUID(), pid, f.name, JSON.stringify(f.steps), now7]
      );
    } catch (_) {}
  });

  db.persist();

  const gc = db.get('SELECT COUNT(*) as c FROM goals   WHERE project_id=?', [pid]);
  const fc = db.get('SELECT COUNT(*) as c FROM funnels WHERE project_id=?', [pid]);
  console.log(`✓ Goals: ${gc.c}  |  Funnels: ${fc.c}`);
  console.log('\nAll done! Open the dashboard to see the data.');
}

main().catch(err => { console.error(err); process.exit(1); });
