'use strict';

const express       = require('express');
const router        = express.Router();
const apiKeyAuth    = require('../middleware/apiKeyAuth');
const { trackLimiter }       = require('../middleware/rateLimiter');
const { validateTrackPayload } = require('../middleware/validate');
const eventService  = require('../services/eventService');

/**
 * POST /track
 *
 * Public endpoint — called by the tracker SDK from any website.
 * CORS is open (configured in server.js via helmet + cors).
 *
 * Pipeline:
 *   1. trackLimiter  — rate limit by API key
 *   2. apiKeyAuth    — resolve API key → req.project
 *   3. validateTrackPayload — sanitize + normalize → req.events
 *   4. write to DB   — respond 202 immediately
 */
router.post(
  '/',
  trackLimiter,
  apiKeyAuth,
  validateTrackPayload,
  (req, res) => {
    try {
      const meta = {
        ip:        req.ip,
        userAgent: req.headers['user-agent'] || null,
      };

      const count = eventService.writeEvents(req.project.id, req.events, meta);

      // 202 Accepted — we received and stored it, not just queued it
      res.status(202).json({ accepted: count });
    } catch (err) {
      console.error('[track] Write error:', err.message);
      res.status(500).json({ error: 'Failed to store events' });
    }
  }
);

module.exports = router;
