'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for POST /track
 *
 * Keyed by API key (not IP) so:
 *   - legitimate high-traffic sites aren't blocked by shared NAT/proxies
 *   - a single abusive key is throttled without affecting other tenants
 *
 * 500 events/min is generous for real browser traffic.
 * Raise per-plan in a future billing upgrade (e.g. pro = 5000/min).
 */
const trackLimiter = rateLimit({
  windowMs:       60 * 1000,  // 1 minute
  max:            500,
  standardHeaders: true,
  legacyHeaders:   false,
  message:        { error: 'Rate limit exceeded. Please slow down.' },
  keyGenerator:   (req) => req.body?.projectKey || req.ip,
});

/**
 * Rate limiter for auth endpoints (register / login)
 *
 * 20 requests per 15 minutes per IP — blocks credential stuffing.
 */
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:        { error: 'Too many attempts. Please try again later.' },
});

module.exports = { trackLimiter, authLimiter };
