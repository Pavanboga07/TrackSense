'use strict';

// Fields the tracker SDK is allowed to send — anything else is stripped
const ALLOWED_FIELDS = new Set([
  'projectKey',
  'sessionId',
  'userId',     // from SI.identify()
  'event',
  'page',
  'url',
  'element',
  'metadata',
  'timestamp',
]);

const REQUIRED_FIELDS = ['sessionId', 'event', 'timestamp'];

// Max events in a single batched POST request
// Raised to 100 — richer auto-tracking (rage_click, video, errors) can generate more events
const MAX_BATCH_SIZE = 100;

// Field length caps — prevent abuse / oversized payloads
const FIELD_LIMITS = {
  event:     100,
  sessionId: 128,
  userId:    256,
  page:      500,
  url:       2000,
  element:   100,
};

/**
 * Validate and sanitize a single raw event object.
 * Returns { valid: true, data } or { valid: false, error: string }
 */
function sanitizeEvent(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, error: 'Each event must be a plain object' };
  }

  // Check required fields exist and are non-empty strings
  for (const field of REQUIRED_FIELDS) {
    if (!raw[field] || typeof raw[field] !== 'string' || !raw[field].trim()) {
      return { valid: false, error: `Missing or invalid required field: "${field}"` };
    }
  }

  // Strip unknown fields (defense against injection attempts / bloat)
  const clean = {};
  for (const key of ALLOWED_FIELDS) {
    if (raw[key] !== undefined) clean[key] = raw[key];
  }

  // Apply string length caps
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (clean[field]) clean[field] = String(clean[field]).slice(0, limit);
  }

  // Normalize metadata — must be a plain object
  if (clean.metadata !== undefined) {
    if (typeof clean.metadata === 'string') {
      try {
        clean.metadata = JSON.parse(clean.metadata);
      } catch {
        clean.metadata = {};
      }
    }
    if (typeof clean.metadata !== 'object' || Array.isArray(clean.metadata)) {
      clean.metadata = {};
    }
  } else {
    clean.metadata = {};
  }

  return { valid: true, data: clean };
}

/**
 * Express middleware — validates /track request body.
 * Accepts a single event object OR an array (batch).
 * Attaches `req.events` (always a normalized array) on success.
 */
function validateTrackPayload(req, res, next) {
  const body = req.body;

  if (!body || (typeof body !== 'object')) {
    return res.status(400).json({ error: 'Request body must be a JSON object or array' });
  }

  const rawList = Array.isArray(body) ? body : [body];

  if (rawList.length === 0) {
    return res.status(400).json({ error: 'No events provided' });
  }

  if (rawList.length > MAX_BATCH_SIZE) {
    return res.status(400).json({
      error: `Batch exceeds maximum size of ${MAX_BATCH_SIZE} events`,
    });
  }

  const events = [];
  for (let i = 0; i < rawList.length; i++) {
    const result = sanitizeEvent(rawList[i]);
    if (!result.valid) {
      return res.status(400).json({ error: `Event[${i}]: ${result.error}` });
    }
    events.push(result.data);
  }

  req.events = events;
  next();
}

module.exports = { validateTrackPayload };
