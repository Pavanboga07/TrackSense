'use strict';

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db     = require('../db');

/**
 * Generate a cryptographically secure API key.
 * Format: pk_live_<48 hex chars>  (looks professional, easily recognizable)
 */
function generateApiKey() {
  return 'pk_live_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Create a new project for a user.
 */
function createProject({ userId, name, domain }) {
  const id     = uuidv4();
  const apiKey = generateApiKey();
  const now    = new Date().toISOString();

  db.run(
    'INSERT INTO projects (id, user_id, name, domain, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, name.trim(), domain?.trim() || null, apiKey, now]
  );
  db.persist();

  return getProject(id, userId);
}

/**
 * Return all projects owned by a user.
 */
function getProjects(userId) {
  return db.all(
    'SELECT id, name, domain, api_key, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
}

/**
 * Return a single project — enforces ownership (userId check).
 */
function getProject(id, userId) {
  const project = db.get(
    'SELECT id, name, domain, api_key, created_at FROM projects WHERE id = ? AND user_id = ?',
    [id, userId]
  );

  if (!project) {
    throw Object.assign(new Error('Project not found'), { status: 404 });
  }

  return project;
}

/**
 * Delete a project (and all its events via CASCADE).
 */
function deleteProject(id, userId) {
  const changes = db.run('DELETE FROM projects WHERE id = ? AND user_id = ?', [id, userId]);

  if (changes === 0) {
    throw Object.assign(new Error('Project not found'), { status: 404 });
  }
  db.persist();
}

/**
 * Rotate the API key — old key becomes immediately invalid.
 */
function rotateApiKey(id, userId) {
  const newKey  = generateApiKey();
  const changes = db.run(
    'UPDATE projects SET api_key = ? WHERE id = ? AND user_id = ?',
    [newKey, id, userId]
  );

  if (changes === 0) {
    throw Object.assign(new Error('Project not found'), { status: 404 });
  }
  db.persist();

  return getProject(id, userId);
}

module.exports = { createProject, getProjects, getProject, deleteProject, rotateApiKey };
