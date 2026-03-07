'use strict';

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const adminAuth      = require('../middleware/adminAuth');
const db             = require('../db');

// All admin routes require a valid JWT with role=admin
router.use(authMiddleware, adminAuth);

/**
 * GET /admin/stats
 * Platform-wide statistics for the admin overview page.
 */
router.get('/stats', (req, res) => {
  try {
    const totalUsers    = db.get('SELECT COUNT(*) AS c FROM users WHERE role = ?', ['customer']).c;
    const totalProjects = db.get('SELECT COUNT(*) AS c FROM projects').c;
    const totalEvents   = db.get('SELECT COUNT(*) AS c FROM events').c;

    // Events today — timestamps are stored as Unix ms strings
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayEvents = db.get(
      'SELECT COUNT(*) AS c FROM events WHERE CAST(timestamp AS INTEGER) >= ?',
      [startOfDay.getTime()]
    ).c;

    const recentUsers = db.all(
      `SELECT id, email, name, plan, created_at
       FROM users WHERE role = 'customer'
       ORDER BY created_at DESC LIMIT 10`
    );

    res.json({ stats: { totalUsers, totalProjects, totalEvents, todayEvents, recentUsers } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/customers
 * List all customer accounts with project + event counts.
 */
router.get('/customers', (req, res) => {
  try {
    const customers = db.all(
      `SELECT
         u.id, u.email, u.name, u.plan, u.created_at,
         (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS project_count,
         (SELECT COUNT(*) FROM events e
            JOIN projects p2 ON e.project_id = p2.id
            WHERE p2.user_id = u.id) AS event_count
       FROM users u
       WHERE u.role = 'customer'
       ORDER BY u.created_at DESC`
    );
    res.json({ customers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/customers/:id
 * A single customer's profile + all their projects with event counts.
 */
router.get('/customers/:id', (req, res) => {
  try {
    const customer = db.get(
      `SELECT id, email, name, plan, created_at
       FROM users WHERE id = ? AND role = 'customer'`,
      [req.params.id]
    );
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const projects = db.all(
      `SELECT p.id, p.name, p.domain, p.api_key, p.created_at,
              COUNT(e.id) AS event_count
       FROM projects p
       LEFT JOIN events e ON e.project_id = p.id
       WHERE p.user_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.params.id]
    );

    res.json({ customer, projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
