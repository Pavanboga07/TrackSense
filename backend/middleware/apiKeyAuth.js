'use strict';

const db = require('../db');

/**
 * API Key Authentication Middleware
 *
 * Resolves the tracker's project API key to a real project row.
 * Attaches `req.project` on success.
 *
 * The key can arrive as:
 *   - req.body.projectKey  (JSON payload from tracker SDK)
 *   - Authorization: Bearer pk_live_xxx (programmatic use)
 */
function apiKeyAuth(req, res, next) {
  // The tracker sends batches as arrays — the key lives in body[0].projectKey
  const bodyKey = Array.isArray(req.body)
    ? req.body[0]?.projectKey
    : req.body?.projectKey;

  const key =
    bodyKey ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!key) {
    return res.status(401).json({ error: 'Missing API key' });
  }

  const project = db.get(
    'SELECT id, name, user_id FROM projects WHERE api_key = ?',
    [key]
  );

  if (!project) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.project = project;
  next();
}

module.exports = apiKeyAuth;
