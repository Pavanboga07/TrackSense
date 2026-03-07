'use strict';

const express      = require('express');
const router       = express.Router();
const { authLimiter } = require('../middleware/rateLimiter');
const authMiddleware  = require('../middleware/auth');
const authService     = require('../services/authService');

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  const { email, password, name, adminKey } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const user = await authService.register({ email, password, name, adminKey });
    res.status(201).json({ user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await authService.login({ email, password });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /auth/me — verify token + return current user ────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  try {
    const user = authService.getUser(req.user.id);
    res.json({ user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
