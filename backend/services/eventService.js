'use strict';

const db = require('../db');

const INSERT_SQL =
  'INSERT INTO events ' +
  '(project_id, session_id, event, page, url, element, metadata, ip, user_agent, timestamp) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/**
 * Write one or more validated events for a project.
 *
 * @param {string} projectId  - resolved from the API key
 * @param {object[]} events   - sanitized by validateTrackPayload middleware
 * @param {{ ip, userAgent }} meta - from request headers
 * @returns {number} count of stored events
 */
function writeEvents(projectId, events, meta) {
  db.transaction(() => {
    for (const e of events) {
      db.run(INSERT_SQL, [
        projectId,
        e.sessionId,
        e.event,
        e.page       || null,
        e.url        || null,
        e.element    || null,
        JSON.stringify(e.metadata || {}),
        meta.ip        || null,
        meta.userAgent || null,
        e.timestamp,
      ]);
    }
  });
  db.persist();
  return events.length;
}

/**
 * Query events for a project with optional filters.
 * All filtering is done in DB — never loads full table into memory.
 *
 * @param {string} projectId
 * @param {{ event?, sessionId?, page?, limit?, offset? }} filters
 */
function queryEvents(projectId, filters = {}) {
  const { event, sessionId, page } = filters;
  const limit  = Math.min(Number(filters.limit)  || 100, 1000);
  const offset = Math.max(Number(filters.offset) || 0,   0);

  let sql    = 'SELECT * FROM events WHERE project_id = ?';
  const params = [projectId];

  if (event) {
    sql += ' AND event = ?';
    params.push(event);
  }
  if (sessionId) {
    sql += ' AND session_id = ?';
    params.push(sessionId);
  }
  if (page) {
    sql += ' AND page = ?';
    params.push(page);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.all(sql, params);

  // Deserialize metadata JSON for API consumers
  return rows.map((r) => ({
    ...r,
    metadata: (() => {
      try { return JSON.parse(r.metadata); } catch { return {}; }
    })(),
  }));
}

/**
 * Aggregate stats for a project's dashboard.
 * All queries use the compound indexes — fast even at large scale.
 */
function getStats(projectId) {
  const totalEvents = db.get(
    'SELECT COUNT(*) AS count FROM events WHERE project_id = ?',
    [projectId]
  ).count;

  const totalSessions = db.get(
    'SELECT COUNT(DISTINCT session_id) AS count FROM events WHERE project_id = ?',
    [projectId]
  ).count;

  const eventBreakdown = db.all(
    'SELECT event, COUNT(*) AS count FROM events WHERE project_id = ? GROUP BY event ORDER BY count DESC',
    [projectId]
  );

  const topPages = db.all(
    `SELECT page, COUNT(*) AS count
     FROM events
     WHERE project_id = ? AND event = 'page_view' AND page IS NOT NULL
     GROUP BY page
     ORDER BY count DESC
     LIMIT 10`,
    [projectId]
  );

  const recentSessions = db.all(
    `SELECT session_id, MIN(timestamp) AS started_at, COUNT(*) AS event_count
     FROM events
     WHERE project_id = ?
     GROUP BY session_id
     ORDER BY started_at DESC
     LIMIT 20`,
    [projectId]
  );

  return { totalEvents, totalSessions, eventBreakdown, topPages, recentSessions };
}

module.exports = { writeEvents, queryEvents, getStats };
