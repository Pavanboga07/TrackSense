'use strict';

const jwt = require('jsonwebtoken');

/**
 * JWT Authentication Middleware
 *
 * Verifies the token from: Authorization: Bearer <jwt>
 * Attaches `req.user = { id, email }` on success.
 *
 * Used on all dashboard-facing routes (/projects, /events).
 * NOT used on /track — that uses apiKeyAuth instead.
 */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    // Distinguish expired vs tampered — same 401, different message
    const message =
      err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return res.status(401).json({ error: message });
  }
}

module.exports = authMiddleware;
