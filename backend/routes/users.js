'use strict';
/**
 * GET /users?projectId=xxx[&limit=50][&offset=0][&q=search]
 *   → List of identified users (events where user_id IS NOT NULL)
 *
 * GET /users/:userId?projectId=xxx
 *   → Full profile: user info + all sessions + event timeline per session
 */

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');
const db             = require('../db');

router.use(authMiddleware);

// ── GET /users ───────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);

    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const q      = req.query.q ? `%${req.query.q.replace(/[%_]/g, '\\$&')}%` : null;

    const filterClause = q ? "AND user_id LIKE ? ESCAPE '\\'" : '';
    const params       = q ? [projectId, q] : [projectId];

    const users = db.all(
      `SELECT
         user_id,
         COUNT(DISTINCT session_id)            AS sessions,
         CAST(MIN(timestamp) AS TEXT)          AS firstSeen,
         CAST(MAX(timestamp) AS TEXT)          AS lastSeen,
         COUNT(*)                              AS totalEvents
       FROM events
       WHERE project_id=? AND user_id IS NOT NULL AND user_id != '' ${filterClause}
       GROUP BY user_id
       ORDER BY lastSeen DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const countRow = db.all(
      `SELECT COUNT(DISTINCT user_id) AS total FROM events
       WHERE project_id=? AND user_id IS NOT NULL AND user_id != '' ${filterClause}`,
      params
    );
    const total = countRow[0]?.total ?? 0;

    res.json({ users, total, limit, offset });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /users/:userId ───────────────────────────────────────────────────────
router.get('/:userId', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);

    const userId = req.params.userId;

    // User summary
    const summary = db.all(
      `SELECT
         user_id,
         COUNT(DISTINCT session_id) AS sessions,
         CAST(MIN(timestamp) AS TEXT) AS firstSeen,
         CAST(MAX(timestamp) AS TEXT) AS lastSeen,
         COUNT(*)                     AS totalEvents
       FROM events
       WHERE project_id=? AND user_id=?`,
      [projectId, userId]
    );

    // All events for this user, newest first (limit 500 for safety)
    const events = db.all(
      `SELECT id, session_id, event, page, url, element, metadata, timestamp
       FROM events
       WHERE project_id=? AND user_id=?
       ORDER BY timestamp ASC
       LIMIT 500`,
      [projectId, userId]
    );

    // Group events into sessions
    const sessionsMap = {};
    events.forEach(ev => {
      const sid = ev.session_id;
      if (!sessionsMap[sid]) sessionsMap[sid] = { sessionId: sid, events: [], firstTs: ev.timestamp, lastTs: ev.timestamp };
      sessionsMap[sid].events.push({
        id:        ev.id,
        event:     ev.event,
        page:      ev.page,
        url:       ev.url,
        element:   ev.element,
        metadata:  (() => { try { return JSON.parse(ev.metadata); } catch { return {}; } })(),
        timestamp: ev.timestamp,
      });
      if (ev.timestamp < sessionsMap[sid].firstTs) sessionsMap[sid].firstTs = ev.timestamp;
      if (ev.timestamp > sessionsMap[sid].lastTs)  sessionsMap[sid].lastTs  = ev.timestamp;
    });

    const sessionList = Object.values(sessionsMap).sort((a, b) => b.firstTs.localeCompare(a.firstTs));

    res.json({
      user: summary[0] ?? { user_id: userId, sessions: 0, firstSeen: null, lastSeen: null, totalEvents: 0 },
      sessions: sessionList,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
