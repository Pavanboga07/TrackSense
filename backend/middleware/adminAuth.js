'use strict';

/**
 * Admin Authorization Middleware
 *
 * Must be used AFTER authMiddleware (which sets req.user).
 * Rejects any request where req.user.role !== 'admin'.
 */
function adminAuth(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = adminAuth;
