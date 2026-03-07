-- ============================================================
--  StartupInsight AI — Migration 002: Goals & Funnels
--  Run automatically on server start via db/index.js
-- ============================================================

-- ── Goals ─────────────────────────────────────────────────────
-- A goal = named conversion event a project owner wants to track.
-- event_name: the 'event' field to watch (e.g. 'goal_triggered')
-- conditions: JSON — optional filters e.g. {"goal_name":"upgrade_clicked"}
CREATE TABLE IF NOT EXISTS goals (
  id          TEXT  PRIMARY KEY,
  project_id  TEXT  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT  NOT NULL,
  event_name  TEXT  NOT NULL DEFAULT 'goal_triggered',
  conditions  TEXT  NOT NULL DEFAULT '{}',
  created_at  TEXT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_goals_project ON goals (project_id);

-- ── Funnels ───────────────────────────────────────────────────
-- A funnel = ordered list of page paths or event names.
-- steps: JSON array e.g. ["/pricing", "/checkout", "/thank-you"]
CREATE TABLE IF NOT EXISTS funnels (
  id          TEXT  PRIMARY KEY,
  project_id  TEXT  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT  NOT NULL,
  steps       TEXT  NOT NULL, -- JSON array of step descriptors
  created_at  TEXT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_funnels_project ON funnels (project_id);
