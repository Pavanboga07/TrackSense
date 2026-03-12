'use strict';

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');
const db             = require('../db');

router.use(authMiddleware);

function parseMeta(raw) {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function avg(sum, count) {
  return count > 0 ? Math.round(sum / count) : null;
}

function sourceType(meta) {
  const referrer = String(meta.referrer || '').toLowerCase();
  const medium   = String(meta.utm_medium || '').toLowerCase();

  if (['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search'].includes(medium)) return 'paid';
  if (medium === 'organic') return 'organic';
  if (!referrer && !meta.utm_source) return 'direct';

  const socialSites = ['facebook', 'instagram', 'twitter', 'x.com', 'linkedin', 'tiktok', 'youtube', 'reddit', 'pinterest'];
  const searchSites = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'yandex.', 'baidu.'];

  if (socialSites.some(site => referrer.includes(site))) return 'social';
  if (searchSites.some(site => referrer.includes(site))) return 'organic';
  return 'referral';
}

function seoScoreForPage(page) {
  let score = 100;

  if (page.avgDwellMs !== null) {
    if (page.avgDwellMs < 15000) score -= 25;
    else if (page.avgDwellMs < 30000) score -= 10;
  }

  if (page.bounceRate > 60) score -= 20;
  else if (page.bounceRate > 40) score -= 10;

  if (page.avgScrollDepth !== null) {
    if (page.avgScrollDepth < 30) score -= 15;
    else if (page.avgScrollDepth < 50) score -= 7;
  }

  score -= Math.min(20, page.jsErrors * 10);

  if (page.avgLoadMs !== null) {
    if (page.avgLoadMs > 3000) score -= 15;
    else if (page.avgLoadMs > 1500) score -= 7;
  }

  return Math.max(0, Math.min(100, score));
}

function scoreLabel(score) {
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Healthy';
  if (score >= 40) return 'Needs work';
  return 'Critical';
}

router.get('/summary', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  try {
    projectService.getProject(projectId, req.user.id);

    const days    = Math.min(Number(req.query.days) || 30, 90);
    const since   = new Date(Date.now() - days * 86400000).toISOString();
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();

    const sessionStarts = db.all(
      `SELECT session_id, metadata
       FROM events
       WHERE project_id=? AND event='session_start' AND timestamp>=?`,
      [projectId, since]
    );
    const pageViews = db.all(
      `SELECT page, session_id, url, timestamp, metadata
       FROM events
       WHERE project_id=? AND event='page_view' AND page IS NOT NULL AND timestamp>=?`,
      [projectId, since]
    );
    const pageExits = db.all(
      `SELECT page, session_id, metadata
       FROM events
       WHERE project_id=? AND event='page_exit' AND page IS NOT NULL AND timestamp>=?`,
      [projectId, since]
    );
    const scrollRows = db.all(
      `SELECT page, metadata
       FROM events
       WHERE project_id=? AND event='scroll_depth' AND page IS NOT NULL AND timestamp>=?`,
      [projectId, since]
    );
    const performanceRows = db.all(
      `SELECT page, metadata
       FROM events
       WHERE project_id=? AND event='page_performance' AND page IS NOT NULL AND timestamp>=?`,
      [projectId, since]
    );
    const errorRows = db.all(
      `SELECT page, COUNT(*) as cnt
       FROM events
       WHERE project_id=? AND event='js_error' AND page IS NOT NULL AND timestamp>=?
       GROUP BY page`,
      [projectId, since]
    );
    const sitemapRows = db.all(
      `SELECT page, url, MAX(timestamp) as lastSeen, COUNT(*) as views
       FROM events
       WHERE project_id=? AND event='page_view' AND page IS NOT NULL AND timestamp>=?
       GROUP BY page, url
       ORDER BY views DESC`,
      [projectId, since90]
    );

    const trafficSources = { organic: 0, direct: 0, social: 0, paid: 0, referral: 0, total: 0 };
    const organicSessions = new Set();
    for (const row of sessionStarts) {
      const meta = parseMeta(row.metadata);
      const type = sourceType(meta);
      trafficSources[type]++;
      trafficSources.total++;
      if (type === 'organic') organicSessions.add(row.session_id);
    }

    const pages = {};
    const ensurePage = (page) => {
      if (!page) return null;
      if (!pages[page]) {
        pages[page] = {
          page,
          views: 0,
          bounceCount: 0,
          dwellSum: 0,
          dwellCount: 0,
          scrollSum: 0,
          scrollCount: 0,
          jsErrors: 0,
          loadSum: 0,
          loadCount: 0,
          ttfbSum: 0,
          ttfbCount: 0,
          domSum: 0,
          domCount: 0,
          transferSum: 0,
          transferCount: 0,
        };
      }
      return pages[page];
    };

    const landingEntries = {};
    for (const row of pageViews) {
      const page = ensurePage(row.page);
      if (!page) continue;
      page.views++;

      const meta = parseMeta(row.metadata);
      if (organicSessions.has(row.session_id) && Number(meta.session_page_num) === 1) {
        landingEntries[`${row.session_id}::${row.page}`] = {
          sessionId: row.session_id,
          page: row.page,
          url: row.url,
        };
      }
    }

    for (const row of pageExits) {
      const page = ensurePage(row.page);
      if (!page) continue;
      const meta = parseMeta(row.metadata);
      const dwell = Number(meta.time_on_page_ms);
      if (!Number.isFinite(dwell) || dwell < 0) continue;
      page.dwellSum += dwell;
      page.dwellCount++;
      if (dwell < 5000) page.bounceCount++;
    }

    for (const row of scrollRows) {
      const page = ensurePage(row.page);
      if (!page) continue;
      const meta = parseMeta(row.metadata);
      const depth = Number(meta.depth_percent);
      if (!Number.isFinite(depth) || depth <= 0) continue;
      page.scrollSum += depth;
      page.scrollCount++;
    }

    for (const row of errorRows) {
      const page = ensurePage(row.page);
      if (!page) continue;
      page.jsErrors = Number(row.cnt) || 0;
    }

    for (const row of performanceRows) {
      const page = ensurePage(row.page);
      if (!page) continue;
      const meta = parseMeta(row.metadata);
      const ttfb = Number(meta.ttfb_ms);
      const dom  = Number(meta.dom_load_ms);
      const load = Number(meta.page_load_ms);
      const size = Number(meta.transfer_kb);
      if (Number.isFinite(ttfb) && ttfb >= 0) { page.ttfbSum += ttfb; page.ttfbCount++; }
      if (Number.isFinite(dom) && dom >= 0) { page.domSum += dom; page.domCount++; }
      if (Number.isFinite(load) && load >= 0) { page.loadSum += load; page.loadCount++; }
      if (Number.isFinite(size) && size >= 0) { page.transferSum += size; page.transferCount++; }
    }

    const mismatchMap = {};
    for (const row of pageExits) {
      const key = `${row.session_id}::${row.page}`;
      const landing = landingEntries[key];
      if (!landing) continue;
      const meta = parseMeta(row.metadata);
      const dwell = Number(meta.time_on_page_ms);
      if (!Number.isFinite(dwell) || dwell >= 15000) continue;
      if (!mismatchMap[row.page]) mismatchMap[row.page] = { page: row.page, url: landing.url, organicLandings: 0, quickBounces: 0, dwellSum: 0 };
      mismatchMap[row.page].quickBounces++;
      mismatchMap[row.page].dwellSum += dwell;
    }
    for (const entry of Object.values(landingEntries)) {
      if (!mismatchMap[entry.page]) mismatchMap[entry.page] = { page: entry.page, url: entry.url, organicLandings: 0, quickBounces: 0, dwellSum: 0 };
      mismatchMap[entry.page].organicLandings++;
    }

    const pageScores = Object.values(pages).map(page => {
      const avgDwellMs     = avg(page.dwellSum, page.dwellCount);
      const avgScrollDepth = avg(page.scrollSum, page.scrollCount);
      const avgTtfbMs      = avg(page.ttfbSum, page.ttfbCount);
      const avgDomMs       = avg(page.domSum, page.domCount);
      const avgLoadMs      = avg(page.loadSum, page.loadCount);
      const avgTransferKb  = avg(page.transferSum, page.transferCount);
      const bounceRate     = page.views > 0 ? Math.round((page.bounceCount / page.views) * 100) : 0;
      const seoScore       = seoScoreForPage({ avgDwellMs, bounceRate, avgScrollDepth, jsErrors: page.jsErrors, avgLoadMs });
      return {
        page: page.page,
        views: page.views,
        avgDwellMs,
        bounceRate,
        avgScrollDepth,
        avgTtfbMs,
        avgDomMs,
        avgLoadMs,
        avgTransferKb,
        performanceSamples: page.loadCount,
        jsErrors: page.jsErrors,
        seoScore,
        scoreLabel: scoreLabel(seoScore),
      };
    }).sort((a, b) => b.seoScore - a.seoScore);

    const pageSpeed = pageScores
      .filter(page => page.avgLoadMs !== null || page.avgTtfbMs !== null || page.avgDomMs !== null)
      .map(page => ({
        page: page.page,
        avgTtfbMs: page.avgTtfbMs,
        avgDomMs: page.avgDomMs,
        avgLoadMs: page.avgLoadMs,
        avgTransferKb: page.avgTransferKb,
        samples: page.performanceSamples,
      }))
      .sort((a, b) => (b.avgLoadMs || 0) - (a.avgLoadMs || 0));

    const intentMismatch = Object.values(mismatchMap)
      .filter(page => page.quickBounces > 0)
      .map(page => ({
        page: page.page,
        url: page.url,
        organicLandings: page.organicLandings,
        quickBounces: page.quickBounces,
        quickBounceRate: page.organicLandings > 0 ? Math.round((page.quickBounces / page.organicLandings) * 100) : 0,
        avgDwellMs: avg(page.dwellSum, page.quickBounces),
      }))
      .sort((a, b) => b.quickBounceRate - a.quickBounceRate)
      .slice(0, 8);

    const bestSitemapByPage = {};
    for (const row of sitemapRows) {
      if (!bestSitemapByPage[row.page] || Number(row.views) > Number(bestSitemapByPage[row.page].views)) {
        bestSitemapByPage[row.page] = row;
      }
    }
    const sitemapUrls = Object.values(bestSitemapByPage)
      .map(row => ({
        page: row.page,
        url: row.url,
        views: Number(row.views) || 0,
        lastSeen: row.lastSeen,
      }))
      .sort((a, b) => b.views - a.views);

    res.json({
      days,
      pageScores,
      trafficSources,
      pageSpeed,
      intentMismatch,
      sitemapUrls,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;