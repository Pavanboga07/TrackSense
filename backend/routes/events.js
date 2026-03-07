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

/**
 * GET /events/session/:sessionId?projectId=xxx
 *
 * Returns all events for a single session, ordered chronologically.
 * Used for session replay / timeline view.
 */
router.get('/session/:sessionId', (req, res) => {
  const { projectId } = req.query;
  const { sessionId } = req.params;

  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);
    const events = eventService.queryEvents(projectId, { sessionId, limit: 1000 });
    const sorted = events.slice().sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
    res.json({ sessionId, events: sorted, count: sorted.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /events/retention?projectId=xxx&days=8&cohortSize=7
 *
 * Weekly cohort-retention table.
 *
 * Methodology:
 *   - Each cohort week = the calendar week a session first appeared.
 *   - A session "returns" in week N if it made page_view events in that week.
 *   - Returns up to `cohorts` weeks with retention percentages.
 *
 * Response: { cohorts: [{ week, newSessions, retention: [100, 42, ...] }] }
 */
router.get('/retention', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);
    const numCohorts = Math.min(Number(req.query.cohorts) || 8, 12);
    const retention  = eventService.getRetention(projectId, numCohorts);
    res.json(retention);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /events/ab?projectId=xxx&property=variant[&goalEvent=goal_triggered&goalName=upgrade_clicked]
 *
 * A/B test results: for each value of `property` (default: 'variant') in
 * click/goal_triggered metadata, count unique sessions and how many converted.
 *
 * Response: { variants: [{ variant, sessions, conversions, rate }] }
 */
router.get('/ab', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);
    const property  = req.query.property  || 'variant';
    const goalEvent = req.query.goalEvent || 'goal_triggered';
    const goalName  = req.query.goalName  || null;
    const days      = Math.min(Number(req.query.days) || 30, 90);
    const result    = eventService.getAbResults(projectId, { property, goalEvent, goalName, days });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;

