'use strict';

const db = require('../db');

const INSERT_SQL =
  'INSERT INTO events ' +
  '(project_id, session_id, user_id, event, page, url, element, metadata, ip, user_agent, timestamp) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

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
        e.userId       || null,
        e.event,
        e.page         || null,
        e.url          || null,
        e.element      || null,
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

/**
 * Weekly cohort retention.
 *
 * For each of the last `numCohorts` calendar weeks:
 *  - Find sessions that *first appeared* in that week.
 *  - For each subsequent week, count how many of those sessions returned.
 *
 * Returns an array of cohort objects:
 *   { week: "2024-W12", newSessions: 48, retention: [100, 62, 41, 28, ...] }
 *  where retention[0] = 100% (seed), retention[k] = % returning in week +k.
 */
function getRetention(projectId, numCohorts = 8) {
  // Fetch (session_id, date) for all sessions — one row per session = their first appearance
  const rows = db.all(
    `SELECT session_id, MIN(timestamp) AS first_seen, timestamp
     FROM events
     WHERE project_id = ?
     GROUP BY session_id`,
    [projectId]
  );

  // Also need all active dates per session for return tracking
  const activityRows = db.all(
    `SELECT DISTINCT session_id, substr(timestamp, 1, 10) AS day
     FROM events WHERE project_id = ?`,
    [projectId]
  );
  // Map session_id -> Set of active ISO dates
  const sessionDays = {};
  for (const r of activityRows) {
    if (!sessionDays[r.session_id]) sessionDays[r.session_id] = new Set();
    sessionDays[r.session_id].add(r.day);
  }

  // ISO week helper: returns "YYYY-Www"
  function isoWeek(isoDate) {
    const d   = new Date(isoDate);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  // Build list of the last N calendar weeks (most recent first)
  const today = new Date();
  const weeks = [];
  for (let i = numCohorts - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(isoWeek(d.toISOString()));
  }

  // Assign each session to its first-seen cohort week
  const cohortMap = {}; // week -> Set of session_ids
  for (const r of rows) {
    const week = isoWeek(r.first_seen);
    if (!cohortMap[week]) cohortMap[week] = new Set();
    cohortMap[week].add(r.session_id);
  }

  // For each cohort week, compute retention array across subsequent weeks
  const cohorts = weeks.map((week, wi) => {
    const newSessions = cohortMap[week] ? [...cohortMap[week]] : [];
    const n = newSessions.length;

    const retention = weeks.slice(wi).map((returnWeek) => {
      if (n === 0) return 0;
      const returning = newSessions.filter((sid) => {
        const days = sessionDays[sid];
        if (!days) return false;
        // Check if any day in sessionDays falls in returnWeek
        for (const day of days) {
          if (isoWeek(day) === returnWeek) return true;
        }
        return false;
      }).length;
      return Number((returning / n * 100).toFixed(1));
    });

    return { week, newSessions: n, retention };
  });

  return { cohorts };
}

/**
 * A/B test results.
 *
 * Reads metadata[property] (e.g. "variant") from all events in the window.
 * For each unique variant value, counts sessions and how many sessions also
 * triggered the goal event (optionally filtered by goal_name in metadata).
 */
function getAbResults(projectId, { property = 'variant', goalEvent = 'goal_triggered', goalName = null, days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // All events in window
  const rows = db.all(
    `SELECT session_id, event, metadata FROM events
     WHERE project_id = ? AND timestamp >= ?`,
    [projectId, since]
  );

  // Build: variant -> Set of session_ids
  // Build: variant -> Set of sessions that converted
  const variantSessions  = {};
  const variantConverted = {};

  for (const r of rows) {
    let meta;
    try { meta = JSON.parse(r.metadata); } catch { meta = {}; }

    const variantVal = meta[property];
    if (!variantVal) continue;

    if (!variantSessions[variantVal])  variantSessions[variantVal]  = new Set();
    if (!variantConverted[variantVal]) variantConverted[variantVal] = new Set();

    variantSessions[variantVal].add(r.session_id);

    // Check if this row is a goal conversion
    const isGoalEvent = r.event === goalEvent;
    const goalMatches = !goalName || meta.goal_name === goalName;
    if (isGoalEvent && goalMatches) {
      variantConverted[variantVal].add(r.session_id);
    }
  }

  const variants = Object.keys(variantSessions).map((v) => {
    const sessions    = variantSessions[v].size;
    const conversions = variantConverted[v] ? variantConverted[v].size : 0;
    return {
      variant:     v,
      sessions,
      conversions,
      rate: sessions > 0 ? Number((conversions / sessions * 100).toFixed(2)) : 0,
    };
  }).sort((a, b) => b.sessions - a.sessions);

  return { property, goalEvent, goalName, variants };
}

module.exports = { writeEvents, queryEvents, getStats, getRetention, getAbResults };
