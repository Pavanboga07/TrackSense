'use strict';

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const projectService = require('../services/projectService');

// All project routes require a valid JWT
router.use(authMiddleware);

// ── GET /projects — list all projects for current user ────────────────────────
router.get('/', (req, res) => {
  try {
    const projects = projectService.getProjects(req.user.id);
    res.json({ projects });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /projects — create a new project ─────────────────────────────────────
router.post('/', (req, res) => {
  const { name, domain } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const project = projectService.createProject({
      userId: req.user.id,
      name,
      domain,
    });
    res.status(201).json({ project });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /projects/:id — get a single project ──────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const project = projectService.getProject(req.params.id, req.user.id);
    res.json({ project });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── DELETE /projects/:id — delete project + all its events (CASCADE) ─────────
router.delete('/:id', (req, res) => {
  try {
    projectService.deleteProject(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /projects/:id/rotate-key — issue a new API key ──────────────────────
router.post('/:id/rotate-key', (req, res) => {
  try {
    const project = projectService.rotateApiKey(req.params.id, req.user.id);
    res.json({ project });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
