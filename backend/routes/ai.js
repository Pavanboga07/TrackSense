'use strict';
/**
 * AI Insights — powered by Ollama (local LLM)
 *
 * POST /ai/insights        — plain-English analytics summary + recommendations
 * POST /ai/friction        — root-cause diagnosis per high-friction page
 * POST /ai/session-summary — narrate what a single session user did
 * POST /ai/query           — answer a freeform question about your data
 *
 * All endpoints require: { projectId } in body + Bearer JWT.
 * Requires: Ollama running locally on port 11434
 * Optional env vars: OLLAMA_MODEL (default: llama3.2), OLLAMA_URL (default: http://localhost:11434)
 */

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');
const db             = require('../db');

router.use(authMiddleware);

// ── Config ────────────────────────────────────────────────────────────────────
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL || 'llama3.2';
const OLLAMA_BASE_URL = process.env.OLLAMA_URL   || 'http://localhost:11434';
const SYSTEM_PERSONA  = `You are TrackSense AI, an expert product analytics assistant. Today is ${new Date().toDateString()}. You analyze real user behavior data and give direct, specific, actionable advice. Be concise. Never invent data not provided to you.`;

// ── Non-streaming Ollama call ─────────────────────────────────────────────────
async function callOllama(prompt) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, system: SYSTEM_PERSONA, prompt, stream: false }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Ollama error ${res.status}`);
  if (!data?.response) throw new Error('No response from Ollama.');
  return data.response.trim();
}

// ── SSE streaming helper (generate endpoint) ──────────────────────────────────
async function streamOllama(prompt, expressRes) {
  expressRes.setHeader('Content-Type', 'text/event-stream');
  expressRes.setHeader('Cache-Control', 'no-cache');
  expressRes.setHeader('Connection', 'keep-alive');
  expressRes.flushHeaders();
  let ollamaRes;
  try {
    ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, system: SYSTEM_PERSONA, prompt, stream: true }),
    });
  } catch (e) {
    expressRes.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    expressRes.end(); return;
  }
  if (!ollamaRes.ok) {
    const err = await ollamaRes.json().catch(() => ({}));
    expressRes.write(`data: ${JSON.stringify({ error: err?.error || `Ollama error ${ollamaRes.status}` })}\n\n`);
    expressRes.end(); return;
  }
  const reader  = ollamaRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.response) expressRes.write(`data: ${JSON.stringify({ token: json.response })}\n\n`);
        if (json.done) { expressRes.write(`data: [DONE]\n\n`); expressRes.end(); return; }
      } catch (_) {}
    }
  }
  expressRes.write(`data: [DONE]\n\n`);
  expressRes.end();
}

// ── SSE streaming helper (chat endpoint) ─────────────────────────────────────
async function streamOllamaChat(messages, systemContext, expressRes) {
  expressRes.setHeader('Content-Type', 'text/event-stream');
  expressRes.setHeader('Cache-Control', 'no-cache');
  expressRes.setHeader('Connection', 'keep-alive');
  expressRes.flushHeaders();
  const ollamaMessages = [
    { role: 'system', content: SYSTEM_PERSONA + '\n\n' + systemContext },
    ...messages,
  ];
  let ollamaRes;
  try {
    ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages: ollamaMessages, stream: true }),
    });
  } catch (e) {
    expressRes.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    expressRes.end(); return;
  }
  if (!ollamaRes.ok) {
    const err = await ollamaRes.json().catch(() => ({}));
    expressRes.write(`data: ${JSON.stringify({ error: err?.error || `Ollama error ${ollamaRes.status}` })}\n\n`);
    expressRes.end(); return;
  }
  const reader  = ollamaRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        const token = json?.message?.content;
        if (token) expressRes.write(`data: ${JSON.stringify({ token })}\n\n`);
        if (json.done) { expressRes.write(`data: [DONE]\n\n`); expressRes.end(); return; }
      } catch (_) {}
    }
  }
  expressRes.write(`data: [DONE]\n\n`);
  expressRes.end();
}

// ── Data fetchers ────────────────────────────────────────────────────────────
function getProjectStats(projectId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const totals = db.get(
    `SELECT COUNT(*) as totalEvents, COUNT(DISTINCT session_id) as totalSessions,
            COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) as identifiedUsers
     FROM events WHERE project_id=? AND timestamp>=?`, [projectId, since]
  ) || {};
  const breakdown = db.all(
    `SELECT event, COUNT(*) as count FROM events WHERE project_id=? AND timestamp>=?
     GROUP BY event ORDER BY count DESC LIMIT 10`, [projectId, since]);
  const topPages = db.all(
    `SELECT page, COUNT(*) as views FROM events
     WHERE project_id=? AND event='page_view' AND timestamp>=?
     GROUP BY page ORDER BY views DESC LIMIT 8`, [projectId, since]);
  const bounces = db.get(
    `SELECT COUNT(DISTINCT session_id) as count FROM events
     WHERE project_id=? AND event='page_exit' AND timestamp>=?
       AND CAST(json_extract(metadata,'$.time_on_page_ms') AS INTEGER) < 5000`,
    [projectId, since]) || {};
  return { totals, breakdown, topPages, bounces: bounces.count || 0, days };
}

function getFrictionData(projectId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rageRows    = db.all(`SELECT page, COUNT(*) as rageClicks FROM events WHERE project_id=? AND event='rage_click' AND timestamp>=? GROUP BY page ORDER BY rageClicks DESC LIMIT 8`, [projectId, since]);
  const errorRows   = db.all(`SELECT page, COUNT(*) as jsErrors FROM events WHERE project_id=? AND event='js_error' AND timestamp>=? GROUP BY page ORDER BY jsErrors DESC LIMIT 8`, [projectId, since]);
  const abandonRows = db.all(`SELECT page, COUNT(*) as formAbandons FROM events WHERE project_id=? AND event='form_abandon' AND timestamp>=? GROUP BY page ORDER BY formAbandons DESC LIMIT 8`, [projectId, since]);
  return { rageRows, errorRows, abandonRows, days };
}

function buildFrictionPages(data) {
  const map = {};
  data.rageRows.forEach(r    => { map[r.page] = map[r.page] || {}; map[r.page].rageClicks    = r.rageClicks; });
  data.errorRows.forEach(r   => { map[r.page] = map[r.page] || {}; map[r.page].jsErrors       = r.jsErrors; });
  data.abandonRows.forEach(r => { map[r.page] = map[r.page] || {}; map[r.page].formAbandons   = r.formAbandons; });
  return Object.entries(map).map(([page, s]) => ({ page, ...s }))
    .filter(p => (p.rageClicks || 0) + (p.jsErrors || 0) + (p.formAbandons || 0) > 0)
    .slice(0, 6);
}

function buildContextSummary(stats, friction) {
  const pages = buildFrictionPages(friction);
  return `PROJECT ANALYTICS (last 30 days):
- Sessions: ${stats.totals.totalSessions} | Events: ${stats.totals.totalEvents} | Users: ${stats.totals.identifiedUsers}
- Bounces: ${stats.bounces}
- Top pages: ${stats.topPages.slice(0, 5).map(p => `${p.page}(${p.views})`).join(', ')}
- Event breakdown: ${stats.breakdown.slice(0, 6).map(e => `${e.event}(${e.count})`).join(', ')}
- Friction pages: ${pages.length ? pages.map(p => `${p.page}[rage:${p.rageClicks || 0},err:${p.jsErrors || 0},abandon:${p.formAbandons || 0}]`).join(', ') : 'none'}`;
}

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildInsightsPrompt(stats) {
  return `Analyze this website analytics data for the last ${stats.days} days.

DATA:
- Total events: ${stats.totals.totalEvents}
- Sessions: ${stats.totals.totalSessions}
- Identified users: ${stats.totals.identifiedUsers}
- Bounce sessions (< 5s): ${stats.bounces}
- Event breakdown: ${JSON.stringify(stats.breakdown.slice(0, 8))}
- Top pages: ${JSON.stringify(stats.topPages.slice(0, 6))}

Respond in EXACTLY this format (no markdown, no intro sentence):

INSIGHTS:
• [specific insight from the data]
• [another insight about user behavior]
• [insight about patterns or engagement]

RECOMMENDATIONS:
• [specific actionable improvement]
• [another improvement]

Each bullet: 1–2 sentences. Reference actual numbers.`;
}

function buildFrictionPrompt(pages) {
  return `Diagnose the friction issues on these web pages.

DATA:
${pages.map(p => `Page: ${p.page}\n  Rage clicks: ${p.rageClicks || 0} | JS errors: ${p.jsErrors || 0} | Form abandons: ${p.formAbandons || 0}`).join('\n')}

For each page use EXACTLY this format:
PAGE: [page path]
DIAGNOSIS: [root cause in 1 sentence]
FIX: [one specific actionable fix]

Blank line between pages. No intro or conclusion.`;
}

function buildSessionPrompt(events) {
  return `Summarize this user session in 3–5 conversational sentences for a product manager.
Cover: pages visited, actions taken, signs of frustration or confusion, whether they converted.

SESSION (${events.length} events):
${JSON.stringify(events, null, 2)}`;
}

// ── SEO data fetcher (used by AI SEO advisor + chat context) ──────────────────
function getSEOData(projectId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const parse = (raw) => { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } };

  const sessionStarts = db.all(
    `SELECT session_id, metadata FROM events WHERE project_id=? AND event='session_start' AND timestamp>=?`,
    [projectId, since]
  );

  const trafficSources = { organic: 0, direct: 0, social: 0, paid: 0, referral: 0 };
  const socialDomains  = ['facebook','instagram','twitter','x.com','linkedin','tiktok','youtube','reddit'];
  const searchDomains  = ['google.','bing.','duckduckgo.','yahoo.','yandex.'];
  for (const row of sessionStarts) {
    const meta     = parse(row.metadata);
    const referrer = String(meta.referrer || '').toLowerCase();
    const medium   = String(meta.utm_medium || '').toLowerCase();
    if (['cpc','ppc','paid','paidsearch','paid_search'].includes(medium)) trafficSources.paid++;
    else if (medium === 'organic')                                         trafficSources.organic++;
    else if (!referrer && !meta.utm_source)                               trafficSources.direct++;
    else if (socialDomains.some(s => referrer.includes(s)))               trafficSources.social++;
    else if (searchDomains.some(s => referrer.includes(s)))               trafficSources.organic++;
    else                                                                   trafficSources.referral++;
  }

  const pageStats = {};
  const ep = (page) => {
    if (!pageStats[page]) pageStats[page] = { views:0, bounceCount:0, dwellSum:0, dwellCount:0, scrollSum:0, scrollCount:0, jsErrors:0, loadSum:0, loadCount:0 };
    return pageStats[page];
  };

  db.all(`SELECT page FROM events WHERE project_id=? AND event='page_view' AND page IS NOT NULL AND timestamp>=?`, [projectId, since])
    .forEach(r => ep(r.page).views++);

  for (const r of db.all(`SELECT page, metadata FROM events WHERE project_id=? AND event='page_exit' AND page IS NOT NULL AND timestamp>=?`, [projectId, since])) {
    const p = ep(r.page), m = parse(r.metadata), d = Number(m.time_on_page_ms);
    if (Number.isFinite(d) && d >= 0) { p.dwellSum += d; p.dwellCount++; if (d < 5000) p.bounceCount++; }
  }

  for (const r of db.all(`SELECT page, metadata FROM events WHERE project_id=? AND event='scroll_depth' AND page IS NOT NULL AND timestamp>=?`, [projectId, since])) {
    const p = ep(r.page), m = parse(r.metadata), d = Number(m.depth_percent);
    if (Number.isFinite(d) && d > 0) { p.scrollSum += d; p.scrollCount++; }
  }

  db.all(`SELECT page, COUNT(*) as cnt FROM events WHERE project_id=? AND event='js_error' AND page IS NOT NULL AND timestamp>=? GROUP BY page`, [projectId, since])
    .forEach(r => ep(r.page).jsErrors = Number(r.cnt) || 0);

  for (const r of db.all(`SELECT page, metadata FROM events WHERE project_id=? AND event='page_performance' AND page IS NOT NULL AND timestamp>=?`, [projectId, since])) {
    const p = ep(r.page), m = parse(r.metadata), l = Number(m.page_load_ms);
    if (Number.isFinite(l) && l >= 0) { p.loadSum += l; p.loadCount++; }
  }

  const pageScores = Object.entries(pageStats).map(([page, p]) => {
    const avgDwell  = p.dwellCount  > 0 ? Math.round(p.dwellSum  / p.dwellCount)  : null;
    const avgScroll = p.scrollCount > 0 ? Math.round(p.scrollSum / p.scrollCount) : null;
    const avgLoad   = p.loadCount   > 0 ? Math.round(p.loadSum   / p.loadCount)   : null;
    const bounce    = p.views > 0 ? Math.round((p.bounceCount / p.views) * 100) : 0;
    let score = 100;
    if (avgDwell  !== null) { if (avgDwell  < 15000) score -= 25; else if (avgDwell  < 30000) score -= 10; }
    if (bounce > 60)          score -= 20; else if (bounce > 40) score -= 10;
    if (avgScroll !== null) { if (avgScroll < 30)    score -= 15; else if (avgScroll < 50)    score -= 7;  }
    score -= Math.min(20, p.jsErrors * 10);
    if (avgLoad   !== null) { if (avgLoad   > 3000)  score -= 15; else if (avgLoad   > 1500)  score -= 7;  }
    return { page, views: p.views, bounceRate: bounce, avgDwellMs: avgDwell, avgScrollDepth: avgScroll, avgLoadMs: avgLoad, jsErrors: p.jsErrors, seoScore: Math.max(0, Math.min(100, score)) };
  }).sort((a, b) => a.seoScore - b.seoScore); // worst first

  const rageRows = db.all(
    `SELECT page, COUNT(*) as cnt FROM events WHERE project_id=? AND event='rage_click' AND page IS NOT NULL AND timestamp>=? GROUP BY page ORDER BY cnt DESC LIMIT 5`,
    [projectId, since]
  );
  return { pageScores, trafficSources, rageRows, totalSessions: sessionStarts.length, days };
}

function buildSEOContextSnippet(seoData) {
  const { pageScores, trafficSources, totalSessions } = seoData;
  const total      = Object.values(trafficSources).reduce((a, b) => a + b, 0);
  const organicPct = total > 0 ? Math.round((trafficSources.organic / total) * 100) : 0;
  const worstPages = pageScores.slice(0, 3).map(p => `${p.page}(score:${p.seoScore})`).join(', ');
  return `SEO CONTEXT: organic traffic ${organicPct}% of ${totalSessions} sessions. Lowest-scoring pages: ${worstPages || 'none tracked'}.`;
}

function buildSEOAdvisorPrompt(seoData) {
  const { pageScores, trafficSources, rageRows, totalSessions, days } = seoData;
  const total     = Object.values(trafficSources).reduce((a, b) => a + b, 0);
  const pct       = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
  const critPages = pageScores.slice(0, 5);
  return `Website SEO performance data (last ${days} days):

TRAFFIC: ${totalSessions} sessions — organic ${pct(trafficSources.organic)}%, direct ${pct(trafficSources.direct)}%, social ${pct(trafficSources.social)}%, paid ${pct(trafficSources.paid)}%, referral ${pct(trafficSources.referral)}%

CRITICAL PAGES (lowest SEO scores):
${critPages.length ? critPages.map(p =>
  `  ${p.page}: score ${p.seoScore}/100 | bounce ${p.bounceRate}% | dwell ${p.avgDwellMs != null ? Math.round(p.avgDwellMs / 1000) + 's' : 'N/A'} | scroll ${p.avgScrollDepth ?? 'N/A'}% | load ${p.avgLoadMs != null ? p.avgLoadMs + 'ms' : 'N/A'} | JS errors ${p.jsErrors}`
).join('\n') : '  (no page data yet)'}
${rageRows.length ? '\nRAGE CLICK PAGES: ' + rageRows.map(r => `${r.page}(${r.cnt})`).join(', ') : ''}
Respond in EXACTLY this format (no intro sentence):

SEO ISSUES:
• [most critical SEO problem — name the page and the specific metric]
• [second SEO issue with actual numbers from the data]
• [third issue affecting organic rankings or user engagement signals]

QUICK WINS:
• [fastest single fix for biggest score improvement — name page and metric to change]
• [low-effort improvement to grow organic traffic share from ${pct(trafficSources.organic)}%]
• [fix that would help 2 or more pages at once]

TRAFFIC GROWTH:
• [one concrete strategy to increase organic sessions based on the current data]
• [one engagement improvement to strengthen dwell and scroll SEO signals]

Each bullet: 1–2 sentences maximum. Use real page names and numbers.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NON-STREAMING ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────
router.post('/insights', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    projectService.getProject(projectId, req.user.id);
    const text = await callOllama(buildInsightsPrompt(getProjectStats(projectId, 30)));
    res.json({ insights: text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/friction', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    projectService.getProject(projectId, req.user.id);
    const pages = buildFrictionPages(getFrictionData(projectId, 30));
    if (!pages.length) return res.json({ diagnoses: 'No friction signals detected in the last 30 days.' });
    res.json({ diagnoses: await callOllama(buildFrictionPrompt(pages)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/session-summary', async (req, res) => {
  const { projectId, sessionId } = req.body;
  if (!projectId || !sessionId) return res.status(400).json({ error: 'projectId and sessionId required' });
  try {
    projectService.getProject(projectId, req.user.id);
    const rows = db.all(`SELECT event, page, metadata FROM events WHERE project_id=? AND session_id=? ORDER BY timestamp ASC LIMIT 80`, [projectId, sessionId]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found.' });
    const simplified = rows.map(e => { let m = {}; try { m = JSON.parse(e.metadata || '{}'); } catch (_) {} return { event: e.event, page: e.page, text: m.text || undefined, goal: m.goal_name || undefined, error: m.message || undefined }; });
    res.json({ summary: await callOllama(buildSessionPrompt(simplified)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/query', async (req, res) => {
  const { projectId, question } = req.body;
  if (!projectId || !question) return res.status(400).json({ error: 'projectId and question required' });
  if (question.length > 400) return res.status(400).json({ error: 'Question too long (max 400 chars)' });
  try {
    projectService.getProject(projectId, req.user.id);
    const ctx = buildContextSummary(getProjectStats(projectId, 30), getFrictionData(projectId, 30));
    res.json({ answer: await callOllama(`${ctx}\n\nAnswer in 2–3 sentences. Be specific.\n\nQUESTION: ${question}`) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────
router.post('/insights/stream', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    projectService.getProject(projectId, req.user.id);
    await streamOllama(buildInsightsPrompt(getProjectStats(projectId, 30)), res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
});

router.post('/friction/stream', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    projectService.getProject(projectId, req.user.id);
    const pages = buildFrictionPages(getFrictionData(projectId, 30));
    if (!pages.length) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ token: 'No friction signals detected in the last 30 days. Your pages appear to be working smoothly!' })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end(); return;
    }
    await streamOllama(buildFrictionPrompt(pages), res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
});

router.post('/session-summary/stream', async (req, res) => {
  const { projectId, sessionId } = req.body;
  if (!projectId || !sessionId) return res.status(400).json({ error: 'projectId and sessionId required' });
  try {
    projectService.getProject(projectId, req.user.id);
    const rows = db.all(`SELECT event, page, metadata FROM events WHERE project_id=? AND session_id=? ORDER BY timestamp ASC LIMIT 80`, [projectId, sessionId]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found.' });
    const simplified = rows.map(e => { let m = {}; try { m = JSON.parse(e.metadata || '{}'); } catch (_) {} return { event: e.event, page: e.page, text: m.text || undefined, goal: m.goal_name || undefined, error: m.message || undefined }; });
    await streamOllama(buildSessionPrompt(simplified), res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
});

// ── POST /ai/chat — streaming chatbot ────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { projectId, messages } = req.body;
  if (!projectId || !Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: 'projectId and messages[] required' });
  const clean = messages.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 2000),
  }));
  try {
    projectService.getProject(projectId, req.user.id);
    const ctx    = buildContextSummary(getProjectStats(projectId, 30), getFrictionData(projectId, 30));
    const seoCtx = buildSEOContextSnippet(getSEOData(projectId, 30));
    await streamOllamaChat(clean, ctx + '\n\n' + seoCtx, res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
});

// ── GET /ai/sessions — recent sessions for dropdown ───────────────────────────
router.get('/sessions', async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    projectService.getProject(projectId, req.user.id);
    const rows = db.all(
      `SELECT session_id, MIN(timestamp) as started_at, COUNT(*) as event_count
       FROM events WHERE project_id=? AND session_id IS NOT NULL
       GROUP BY session_id ORDER BY started_at DESC LIMIT 50`,
      [projectId]
    );
    res.json({ sessions: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /ai/seo-advisor/stream — SEO audit powered by AI ───────────────────
router.post('/seo-advisor/stream', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    projectService.getProject(projectId, req.user.id);
    const seoData = getSEOData(projectId, 30);
    if (!seoData.pageScores.length && !seoData.totalSessions) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ token: 'No SEO data found yet. Start tracking page views to get AI-powered SEO recommendations.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end(); return;
    }
    await streamOllama(buildSEOAdvisorPrompt(seoData), res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
});

module.exports = router;
