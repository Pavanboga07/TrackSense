'use strict';
/**
 * GET /friction?projectId=xxx[&days=30][&page=/pricing]
 *
 * Friction Map — surfaces where users struggle on a page or across all pages.
 * Aggregates signals that indicate user friction:
 *   rage_click   — user clicked same spot 3+ times quickly (frustration)
 *   js_error     — JavaScript error occurred
 *   form_abandon — user started a form but never submitted
 *   scroll_depth — what % of page users actually reach (low = drop-off)
 *   page_exit    — time_on_page < 5s (bounce)
 *
 * Response: { pages: [{ page, rageClicks, jsErrors, formAbandons, avgScrollDepth, bounces, frictionScore }] }
 * frictionScore (0–100) = weighted composite of all signals, higher = more friction.
 */

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');
const db             = require('../db');

router.use(authMiddleware);

router.get('/', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);

    const days  = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const filterPage = req.query.page || null;

    const pageClause = filterPage ? 'AND page = ?' : '';
    const baseParams = filterPage ? [projectId, since, filterPage] : [projectId, since];

    // ── rage_clicks per page ─────────────────────────────────────────────────
    const rageRows = db.all(
      `SELECT page, COUNT(*) as cnt FROM events
       WHERE project_id=? AND event='rage_click' AND timestamp>=? ${pageClause}
       GROUP BY page`,
      baseParams
    );

    // ── js_errors per page ───────────────────────────────────────────────────
    const errorRows = db.all(
      `SELECT page, COUNT(*) as cnt FROM events
       WHERE project_id=? AND event='js_error' AND timestamp>=? ${pageClause}
       GROUP BY page`,
      baseParams
    );

    // ── form_abandon per page ────────────────────────────────────────────────
    const abandonRows = db.all(
      `SELECT page, COUNT(*) as cnt FROM events
       WHERE project_id=? AND event='form_abandon' AND timestamp>=? ${pageClause}
       GROUP BY page`,
      baseParams
    );

    // ── avg scroll_depth per page ────────────────────────────────────────────
    const scrollRows = db.all(
      `SELECT page, metadata FROM events
       WHERE project_id=? AND event='scroll_depth' AND timestamp>=? ${pageClause}`,
      baseParams
    );

    // ── quick bounces: page_exit with time_on_page < 5000ms ─────────────────
    const exitRows = db.all(
      `SELECT page, metadata FROM events
       WHERE project_id=? AND event='page_exit' AND timestamp>=? ${pageClause}`,
      baseParams
    );

    // ── total page_views per page (denominator) ──────────────────────────────
    const pvRows = db.all(
      `SELECT page, COUNT(*) as cnt FROM events
       WHERE project_id=? AND event='page_view' AND timestamp>=? ${pageClause}
       GROUP BY page`,
      baseParams
    );

    // ── aggregate by page ────────────────────────────────────────────────────
    const pages = {};

    const ensure = (p) => {
      if (!p) return;
      if (!pages[p]) pages[p] = { page: p, rageClicks: 0, jsErrors: 0, formAbandons: 0, scrollSum: 0, scrollCount: 0, bounces: 0, pageViews: 0 };
    };

    pvRows.forEach(r    => { ensure(r.page); pages[r.page].pageViews  = r.cnt; });
    rageRows.forEach(r  => { ensure(r.page); pages[r.page].rageClicks = r.cnt; });
    errorRows.forEach(r => { ensure(r.page); pages[r.page].jsErrors   = r.cnt; });
    abandonRows.forEach(r=>{ ensure(r.page); pages[r.page].formAbandons = r.cnt; });

    scrollRows.forEach(r => {
      ensure(r.page);
      try {
        const m = JSON.parse(r.metadata);
        const depth = Number(m.depth || m.percent || 0);
        if (depth > 0) { pages[r.page].scrollSum += depth; pages[r.page].scrollCount++; }
      } catch {}
    });

    exitRows.forEach(r => {
      ensure(r.page);
      try {
        const m = JSON.parse(r.metadata);
        if (Number(m.time_on_page_ms || m.duration_ms || 999999) < 5000) {
          pages[r.page].bounces++;
        }
      } catch {}
    });

    const result = Object.values(pages).map(p => {
      const avgScrollDepth = p.scrollCount > 0 ? Math.round(p.scrollSum / p.scrollCount) : null;
      const bounceRate     = p.pageViews > 0 ? Math.round((p.bounces / p.pageViews) * 100) : 0;

      // Friction score (0–100): weighted composite
      // rage clicks carry most weight, then errors, then abandons, then low scroll, then bounce
      const pvSafe = Math.max(p.pageViews, 1);
      const score  = Math.min(100, Math.round(
        (p.rageClicks   / pvSafe) * 35 * 100 +
        (p.jsErrors     / pvSafe) * 30 * 100 +
        (p.formAbandons / pvSafe) * 20 * 100 +
        (avgScrollDepth !== null ? Math.max(0, (50 - avgScrollDepth) / 50) : 0) * 8 * 100 +
        (bounceRate / 100) * 7 * 100
      ));

      return {
        page: p.page,
        pageViews: p.pageViews,
        rageClicks: p.rageClicks,
        jsErrors: p.jsErrors,
        formAbandons: p.formAbandons,
        avgScrollDepth,
        bounceRate,
        frictionScore: score,
      };
    }).sort((a, b) => b.frictionScore - a.frictionScore);

    res.json({ pages: result, days });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
