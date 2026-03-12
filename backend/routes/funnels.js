'use strict';

const express        = require('express');
const router         = express.Router();
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');
const db             = require('../db');

router.use(authMiddleware);

// ── helpers ───────────────────────────────────────────────────────────────────

function ownedFunnel(funnelId, userId) {
  const funnel = db.get(
    `SELECT f.*, p.user_id FROM funnels f
     JOIN projects p ON p.id = f.project_id
     WHERE f.id = ?`,
    [funnelId]
  );
  if (!funnel)                throw Object.assign(new Error('Funnel not found'), { status: 404 });
  if (funnel.user_id !== userId) throw Object.assign(new Error('Forbidden'),      { status: 403 });
  return funnel;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * GET /funnels?projectId=xxx
 */
router.get('/', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);
    const funnels = db.all(
      'SELECT * FROM funnels WHERE project_id = ? ORDER BY created_at DESC',
      [projectId]
    ).map(f => ({ ...f, steps: JSON.parse(f.steps || '[]') }));
    res.json({ funnels });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /funnels
 * Body: { projectId, name, steps: ["/page1", "/page2", ...] }
 * Each step is a page pathname.  Min 2 steps, max 10.
 */
router.post('/', (req, res) => {
  const { projectId, name, steps } = req.body;
  if (!projectId || !name || !Array.isArray(steps) || steps.length < 2) {
    return res.status(400).json({ error: 'projectId, name and at least 2 steps are required' });
  }
  if (steps.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 steps per funnel' });
  }

  try {
    projectService.getProject(projectId, req.user.id);
    const id  = uuidv4();
    const now = new Date().toISOString();
    db.run(
      'INSERT INTO funnels (id, project_id, name, steps, created_at) VALUES (?,?,?,?,?)',
      [id, projectId, name.trim(), JSON.stringify(steps), now]
    );
    db.persist();
    res.status(201).json({ id, projectId, name: name.trim(), steps, createdAt: now });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * DELETE /funnels/:id
 */
router.delete('/:id', (req, res) => {
  try {
    ownedFunnel(req.params.id, req.user.id);
    db.run('DELETE FROM funnels WHERE id = ?', [req.params.id]);
    db.persist();
    res.json({ deleted: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Funnel Results ─────────────────────────────────────────────────────────────

/**
 * GET /funnels/:id/results?days=30
 *
 * For each step, counts the number of UNIQUE sessions that visited that page
 * AND all preceding pages (in order) within the same session.
 *
 * Algorithm (in-memory over the session set):
 *   1. Fetch all page_view events for this project in the time window.
 *   2. Group by session_id → sorted list of pages visited.
 *   3. For each session, walk the funnel steps in order.
 *      A session "passes" step N if it visited steps 0..N in order
 *      (not necessarily consecutively).
 *   4. Report count per step → drop-off rates.
 */
router.get('/:id/results', (req, res) => {
  try {
    const funnel = ownedFunnel(req.params.id, req.user.id);
    const days   = Math.min(Number(req.query.days) || 30, 90);
    const steps  = JSON.parse(funnel.steps || '[]');
    const since  = new Date(Date.now() - days * 86400000).toISOString();

    // Load all page_view events (only page column needed)
    const rows = db.all(
      `SELECT session_id, page, timestamp
       FROM events
       WHERE project_id = ? AND event = 'page_view' AND timestamp >= ?
       ORDER BY session_id, timestamp ASC`,
      [funnel.project_id, since]
    );

    // Group pages per session (ordered)
    const sessions = {};
    for (const r of rows) {
      if (!sessions[r.session_id]) sessions[r.session_id] = [];
      sessions[r.session_id].push(r.page);
    }

    // For each step, count sessions that completed that step and all before it
    const stepCounts = steps.map(() => 0);

    for (const pages of Object.values(sessions)) {
      let searchFrom = 0;
      for (let i = 0; i < steps.length; i++) {
        const idx = pages.indexOf(steps[i], searchFrom);
        if (idx === -1) break;          // session dropped off here
        stepCounts[i]++;
        searchFrom = idx + 1;           // next step must come after this one
      }
    }

    const totalSessions = Object.keys(sessions).length;

    res.json({
      funnelId:      funnel.id,
      funnelName:    funnel.name,
      steps: steps.map((step, i) => ({
        step,
        sessions:    stepCounts[i],
        dropOff:     i === 0 ? 0 : stepCounts[i - 1] - stepCounts[i],
        dropOffRate: i === 0 || stepCounts[i - 1] === 0
          ? 0
          : Number(((1 - stepCounts[i] / stepCounts[i - 1]) * 100).toFixed(2)),
        conversionFromStart: totalSessions > 0
          ? Number((stepCounts[i] / totalSessions * 100).toFixed(2))
          : 0,
      })),
      totalSessionsInPeriod: totalSessions,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ── Suggestions ───────────────────────────────────────────────────────────────

/**
 * GET /funnels/suggestions?projectId=xxx[&days=30][&minFreq=3]
 *
 * Analyses page_view journeys from the last N days and returns the top 5
 * most common 3-step (or 2- / 4-step) page sequences not already saved.
 *
 * Response: { suggestions: [{ steps: [...], frequency, alreadySaved }] }
 */
router.get('/suggestions', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);

    const days    = Math.min(Number(req.query.days) || 30, 90);
    const minFreq = Math.max(Number(req.query.minFreq) || 2, 2);
    const since   = new Date(Date.now() - days * 86400000).toISOString();

    // ── 1. Load page_view events grouped by session ──────────────────────────
    const rows = db.all(
      `SELECT session_id, page, timestamp FROM events
       WHERE project_id=? AND event='page_view' AND timestamp>=?
         AND page IS NOT NULL AND page != ''
       ORDER BY session_id, timestamp ASC`,
      [projectId, since]
    );

    const sessions = {};
    rows.forEach(r => {
      if (!sessions[r.session_id]) sessions[r.session_id] = [];
      // De-dupe consecutive same-page entries
      const arr = sessions[r.session_id];
      if (arr.length === 0 || arr[arr.length - 1] !== r.page) {
        arr.push(r.page);
      }
    });

    // ── 2. Count N-gram sequences (length 2, 3, 4) ──────────────────────────
    const ngramCounts = {}; // key → count

    Object.values(sessions).forEach(pages => {
      for (let n = 2; n <= Math.min(4, pages.length); n++) {
        for (let i = 0; i <= pages.length - n; i++) {
          const key = pages.slice(i, i + n).join(' → ');
          ngramCounts[key] = (ngramCounts[key] || 0) + 1;
        }
      }
    });

    // ── 3. Fetch existing funnel step-sets for dedup ─────────────────────────
    const existingFunnels = db.all('SELECT steps FROM funnels WHERE project_id=?', [projectId]);
    const savedKeys = new Set(
      existingFunnels.map(f => {
        try { return JSON.parse(f.steps).join(' → '); } catch { return ''; }
      })
    );

    // ── 4. Sort and pick top 5 multi-page suggestions ────────────────────────
    const suggestions = Object.entries(ngramCounts)
      .filter(([key, freq]) => freq >= minFreq && !savedKeys.has(key))
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([key, frequency]) => ({
        steps:       key.split(' → '),
        frequency,
        alreadySaved: false,
      }));

    res.json({ suggestions, days });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;

