'use strict';

const express        = require('express');
const router         = express.Router();
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');
const db             = require('../db');

router.use(authMiddleware);

// ── helpers ───────────────────────────────────────────────────────────────────

function ownedGoal(goalId, userId) {
  const goal = db.get(
    `SELECT g.*, p.user_id FROM goals g
     JOIN projects p ON p.id = g.project_id
     WHERE g.id = ?`,
    [goalId]
  );
  if (!goal)           throw Object.assign(new Error('Goal not found'),  { status: 404 });
  if (goal.user_id !== userId)
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  return goal;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * GET /goals?projectId=xxx
 * List all goals for a project.
 */
router.get('/', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);
    const goals = db.all(
      'SELECT * FROM goals WHERE project_id = ? ORDER BY created_at DESC',
      [projectId]
    ).map(g => ({ ...g, conditions: JSON.parse(g.conditions || '{}') }));
    res.json({ goals });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /goals
 * Create a new goal.
 * Body: { projectId, name, eventName?, conditions? }
 */
router.post('/', (req, res) => {
  const { projectId, name, eventName = 'goal_triggered', conditions = {} } = req.body;
  if (!projectId || !name) {
    return res.status(400).json({ error: 'projectId and name are required' });
  }

  try {
    projectService.getProject(projectId, req.user.id);
    const id   = uuidv4();
    const now  = new Date().toISOString();
    db.run(
      'INSERT INTO goals (id, project_id, name, event_name, conditions, created_at) VALUES (?,?,?,?,?,?)',
      [id, projectId, name.trim(), eventName, JSON.stringify(conditions), now]
    );
    db.persist();
    res.status(201).json({ id, projectId, name: name.trim(), eventName, conditions, createdAt: now });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * DELETE /goals/:id
 */
router.delete('/:id', (req, res) => {
  try {
    ownedGoal(req.params.id, req.user.id);
    db.run('DELETE FROM goals WHERE id = ?', [req.params.id]);
    db.persist();
    res.json({ deleted: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

/**
 * GET /goals/:id/stats?days=30
 *
 * Returns daily conversion counts and total sessions that hit the goal.
 * Matches based on event_name + conditions (goal_name field in metadata).
 */
router.get('/:id/stats', (req, res) => {
  try {
    const goal = ownedGoal(req.params.id, req.user.id);
    const days = Math.min(Number(req.query.days) || 30, 90);
    const conditions = JSON.parse(goal.conditions || '{}');
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // Pull matching events
    const rows = db.all(
      `SELECT session_id, metadata, timestamp
       FROM events
       WHERE project_id = ? AND event = ? AND timestamp >= ?
       ORDER BY timestamp ASC`,
      [goal.project_id, goal.event_name, since]
    );

    // Filter by conditions (e.g. goal_name match)
    const filtered = rows.filter(r => {
      if (!conditions.goal_name) return true;
      try {
        const meta = JSON.parse(r.metadata);
        return meta.goal_name === conditions.goal_name;
      } catch { return false; }
    });

    // Aggregate by day
    const dailyCounts = {};
    const sessionsHit = new Set();
    for (const r of filtered) {
      const day = r.timestamp.slice(0, 10);
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
      sessionsHit.add(r.session_id);
    }

    // Total sessions in same window (for conversion rate)
    const totalSessions = db.get(
      `SELECT COUNT(DISTINCT session_id) AS count FROM events
       WHERE project_id = ? AND timestamp >= ?`,
      [goal.project_id, since]
    ).count;

    res.json({
      goalId:       goal.id,
      goalName:     goal.name,
      total:        filtered.length,
      uniqueSessions: sessionsHit.size,
      totalSessions,
      conversionRate: totalSessions > 0
        ? Number((sessionsHit.size / totalSessions * 100).toFixed(2))
        : 0,
      daily: dailyCounts,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ── Suggestions ───────────────────────────────────────────────────────────────

/**
 * GET /goals/suggestions?projectId=xxx[&days=60]
 *
 * Analyses the last N days of `goal_triggered` events and repetitive custom
 * events and returns up to 10 suggested goals that don't already exist.
 *
 * Response: { suggestions: [{ goal_name, eventName, count, samplePages, alreadySaved }] }
 */
router.get('/suggestions', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);

    const days  = Math.min(Number(req.query.days) || 60, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // ── 1. Explicit goal_triggered events grouped by goal_name in metadata ──
    const triggered = db.all(
      `SELECT metadata, page FROM events
       WHERE project_id=? AND event='goal_triggered' AND timestamp>=?`,
      [projectId, since]
    );

    const nameMap = {}; // goal_name → { count, pages: Set }
    triggered.forEach(r => {
      try {
        const m = JSON.parse(r.metadata);
        const gn = String(m.goal_name || '').trim();
        if (!gn) return;
        if (!nameMap[gn]) nameMap[gn] = { count: 0, pages: new Set() };
        nameMap[gn].count++;
        if (r.page) nameMap[gn].pages.add(r.page);
      } catch {}
    });

    // ── 2. High-frequency custom events that look like conversions ──────────
    const highFreq = db.all(
      `SELECT event, page, COUNT(*) as cnt FROM events
       WHERE project_id=? AND timestamp>=?
         AND event NOT IN ('page_view','click','rage_click','scroll_depth',
                           'form_start','form_submit','form_abandon',
                           'js_error','page_exit','session_start',
                           'outbound_click','element_viewed','video_play',
                           'page_performance','text_copy','tab_hidden',
                           'tab_visible','goal_triggered')
       GROUP BY event
       HAVING cnt >= 3
       ORDER BY cnt DESC
       LIMIT 20`,
      [projectId, since]
    );

    highFreq.forEach(r => {
      const key = r.event;
      if (!nameMap[key]) nameMap[key] = { count: 0, pages: new Set(), isCustomEvent: true };
      nameMap[key].count  += r.cnt;
      if (r.page) nameMap[key].pages.add(r.page);
    });

    // ── 3. Fetch existing goal names for this project ────────────────────────
    const existingGoals = db.all('SELECT name, event_name FROM goals WHERE project_id=?', [projectId]);
    const savedNames = new Set([
      ...existingGoals.map(g => g.name.toLowerCase()),
      ...existingGoals.map(g => (g.event_name || '').toLowerCase()),
    ]);

    // ── 4. Build suggestion list ─────────────────────────────────────────────
    const suggestions = Object.entries(nameMap)
      .filter(([name]) => name.length > 0)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([name, data]) => ({
        goalName:     name,
        eventName:    data.isCustomEvent ? name : 'goal_triggered',
        conditions:   data.isCustomEvent ? {} : { goal_name: name },
        count:        data.count,
        samplePages:  [...data.pages].slice(0, 3),
        alreadySaved: savedNames.has(name.toLowerCase()),
      }));

    res.json({ suggestions, days });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;

