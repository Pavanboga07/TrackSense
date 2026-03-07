-- ============================================================
--  StartupInsight AI — Database Schema
--  Migration: 001_init
--  Run automatically on server start via db/index.js
-- ============================================================

-- ── Users (SaaS tenants) ─────────────────────────────────────
-- Each row = one registered website owner
CREATE TABLE IF NOT EXISTS users (
  id         TEXT    PRIMARY KEY,           -- UUID v4
  email      TEXT    UNIQUE NOT NULL,
  password   TEXT    NOT NULL,              -- bcrypt hash
  name       TEXT    NOT NULL DEFAULT '',
  plan       TEXT    NOT NULL DEFAULT 'free', -- free | pro | enterprise
  role       TEXT    NOT NULL DEFAULT 'customer', -- customer | admin
  created_at TEXT    NOT NULL
);

-- ── Projects (each user can own multiple) ─────────────────────
-- A project = one tracked website
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT    PRIMARY KEY,           -- UUID v4
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  domain     TEXT,                          -- e.g. https://mysite.com (optional hint)
  api_key    TEXT    UNIQUE NOT NULL,       -- pk_live_<48 hex chars>
  created_at TEXT    NOT NULL
);

-- ── Events (all analytics data) ───────────────────────────────
-- Every row is scoped to a project_id — tenants can never cross-query
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id  TEXT    NOT NULL,
  user_id     TEXT,                         -- from SI.identify() — null for anonymous
  event       TEXT    NOT NULL,             -- page_view | click | scroll_depth | js_error | custom…
  page        TEXT,                         -- URL pathname, e.g. /pricing
  url         TEXT,                         -- full URL
  element     TEXT,                         -- tag name for click events
  metadata    TEXT    NOT NULL DEFAULT '{}',-- JSON string — flexible for any future event type
  ip          TEXT,                         -- client IP (store raw for now; hash for GDPR v2)
  user_agent  TEXT,
  timestamp   TEXT    NOT NULL              -- ISO 8601
);

-- ── Indexes — performance from day one ────────────────────────
-- All compound indexes lead with project_id so every query hits an index
CREATE INDEX IF NOT EXISTS idx_events_project_time ON events (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_session       ON events (project_id, session_id);
CREATE INDEX IF NOT EXISTS idx_events_type          ON events (project_id, event);
CREATE INDEX IF NOT EXISTS idx_events_user          ON events (project_id, user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user        ON projects (user_id);
CREATE INDEX IF NOT EXISTS idx_projects_api_key     ON projects (api_key);
