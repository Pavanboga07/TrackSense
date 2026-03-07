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

module.exports = router;
