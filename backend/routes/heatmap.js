'use strict';

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');
const db             = require('../db');

router.use(authMiddleware);

/**
 * GET /heatmap?projectId=xxx&page=/pricing[&days=30]
 *
 * Returns aggregated click-position data for a single page, normalised to a
 * 1280×800 reference viewport so the dashboard can overlay dots on a fixed
 * canvas regardless of the visitor's actual screen size.
 *
 * Each click event stores x/y/vw/vh in metadata (set by tracker.js).
 * Normalization: nx = (x / vw) * 1280,  ny = (y / vh) * 800
 *
 * Response: { page, points: [{ nx, ny, count }], total }
 * Points are bucketed to the nearest 10px grid for performance.
 */
router.get('/', (req, res) => {
  const { projectId, page } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!page)      return res.status(400).json({ error: 'page is required'      });

  try {
    projectService.getProject(projectId, req.user.id);

    const days  = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const rows = db.all(
      `SELECT metadata FROM events
       WHERE project_id = ? AND event = 'click' AND page = ? AND timestamp >= ?`,
      [projectId, page, since]
    );

    // Bucket clicks onto a 10px grid, normalised to 1280×800
    const buckets = {};
    let total = 0;

    for (const r of rows) {
      let meta;
      try { meta = JSON.parse(r.metadata); } catch { continue; }

      const x  = Number(meta.x);
      const y  = Number(meta.y);
      const vw = Number(meta.window_w) || 1280;
      const vh = Number(meta.window_h) || 800;

      if (!x && !y) continue; // tracker didn't capture position for this click

      const nx = Math.round((x / vw) * 1280 / 10) * 10;
      const ny = Math.round((y / vh) * 800  / 10) * 10;
      const key = `${nx},${ny}`;
      buckets[key] = (buckets[key] || 0) + 1;
      total++;
    }

    const points = Object.entries(buckets).map(([key, count]) => {
      const [nx, ny] = key.split(',').map(Number);
      return { nx, ny, count };
    });

    res.json({ page, points, total });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /heatmap/pages?projectId=xxx&days=30
 *
 * Returns a list of pages that have click data, ordered by click count.
 * Use this to populate the page picker in the dashboard.
 */
router.get('/pages', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);
    const days  = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const pages = db.all(
      `SELECT page, COUNT(*) AS clicks
       FROM events
       WHERE project_id = ? AND event = 'click' AND page IS NOT NULL AND timestamp >= ?
       GROUP BY page
       ORDER BY clicks DESC
       LIMIT 50`,
      [projectId, since]
    );

    res.json({ pages });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
