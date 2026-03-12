'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');

// ── Initialise DB (async — sql.js loads WASM before opening the file) ─────────
const db = require('./db');

const app = express();

// ── Security headers (helmet) ─────────────────────────────────────────────────
// Allow tracker.js to be served cross-origin
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ── CORS ──────────────────────────────────────────────────────────────────────
// /track must be reachable from any domain (tracker is embedded everywhere).
// Dashboard API uses the same CORS setup for simplicity.
const rawOrigins  = process.env.ALLOWED_ORIGINS || '*';
const allowedList = rawOrigins.split(',').map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no Origin header (curl, Postman, server-to-server)
      if (!origin) return cb(null, true);
      if (allowedList.includes('*') || allowedList.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error(`Origin "${origin}" not allowed by CORS`));
    },
    methods:        ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials:    true,
  })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));

// ── Serve tracker SDK as a static file ───────────────────────────────────────
// Any website can include:  <script src="http://localhost:5000/tracker.js"></script>
app.get('/tracker.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5-minute CDN cache
  res.sendFile(path.resolve(__dirname, '../tracker/tracker.js'));
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/auth',     require('./routes/auth'));
app.use('/projects', require('./routes/projects'));
app.use('/track',    require('./routes/track'));
app.use('/events',   require('./routes/events'));
app.use('/goals',    require('./routes/goals'));
app.use('/funnels',  require('./routes/funnels'));
app.use('/heatmap',  require('./routes/heatmap'));
app.use('/friction', require('./routes/friction'));
app.use('/seo',      require('./routes/seo'));
app.use('/users',    require('./routes/users'));
app.use('/ai',       require('./routes/ai'));
app.use('/admin',    require('./routes/admin'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 5000;

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`
  ╔══════════════════════════════════════════════╗
  ║   StartupInsight AI — Backend Running        ║
  ╠══════════════════════════════════════════════╣
  ║  http://localhost:${PORT}                       ║
  ║                                              ║
  ║  POST /track        (tracker SDK endpoint)   ║
  ║  GET  /tracker.js   (serve SDK file)         ║
  ║  POST /auth/register                         ║
  ║  POST /auth/login                            ║
  ║  GET  /projects                              ║
  ║  GET  /events?projectId=xxx                  ║
  ║  GET  /events/stats?projectId=xxx            ║
  ║  GET  /health                                ║
  ╚══════════════════════════════════════════════╝
      `);
    });
  })
  .catch((err) => {
    console.error('[FATAL] DB init failed:', err.message);
    process.exit(1);
  });
