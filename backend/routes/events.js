'use strict';

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');
const eventService   = require('../services/eventService');

// All event query routes require a valid JWT
router.use(authMiddleware);

/**
 * GET /events?projectId=xxx[&event=click][&sessionId=yyy][&page=/pricing][&limit=100][&offset=0]
 *
 * Returns raw event rows for the given project.
 * Ownership is enforced — the user must own the project.
 */
router.get('/', (req, res) => {
  const { projectId, event, sessionId, page, limit, offset } = req.query;

  if (!projectId) {
    return res.status(400).json({ error: 'projectId query param is required' });
  }

  try {
    // Verify ownership before querying events
    projectService.getProject(projectId, req.user.id);

    const events = eventService.queryEvents(projectId, {
      event,
      sessionId,
      page,
      limit,
      offset,
    });

    res.json({ events, count: events.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /events/stats?projectId=xxx
 *
 * Returns aggregated stats: total events, unique sessions,
 * event type breakdown, top pages, recent sessions.
 */
router.get('/stats', (req, res) => {
  const { projectId } = req.query;

  if (!projectId) {
    return res.status(400).json({ error: 'projectId query param is required' });
  }

  try {
    projectService.getProject(projectId, req.user.id);
    const stats = eventService.getStats(projectId);
    res.json({ stats });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
