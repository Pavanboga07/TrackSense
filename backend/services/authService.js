'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db     = require('../db');

const SALT_ROUNDS = 12;

/**
 * Register a new user.
 * Throws with .status set for HTTP responses.
 */
async function register({ email, password, name, adminKey }) {
  const normalizedEmail = email.toLowerCase().trim();

  const existing = db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail]);

  if (existing) {
    throw Object.assign(new Error('Email already registered'), { status: 409 });
  }

  // Only grant admin role when the correct ADMIN_SETUP_KEY is supplied
  const role = (adminKey && process.env.ADMIN_SETUP_KEY && adminKey === process.env.ADMIN_SETUP_KEY)
    ? 'admin'
    : 'customer';

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const id   = uuidv4();
  const now  = new Date().toISOString();

  db.run(
    'INSERT INTO users (id, email, password, name, plan, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, normalizedEmail, hash, (name || '').trim(), 'free', role, now]
  );
  db.persist();

  return { id, email: normalizedEmail, name: (name || '').trim(), plan: 'free', role, created_at: now };
}

/**
 * Login and return a JWT + public user data.
 */
async function login({ email, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  const user = db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

  // Use constant-time compare regardless of whether user exists
  // (prevents timing-based email enumeration)
  const hash  = user?.password || '$2a$12$invalidhashforfakecompare000000000000000000000';
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role || 'customer' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role || 'customer' },
  };
}

/**
 * Get public user data by ID.
 */
function getUser(id) {
  const user = db.get(
    'SELECT id, email, name, plan, role, created_at FROM users WHERE id = ?',
    [id]
  );

  if (!user) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  return user;
}

module.exports = { register, login, getUser };
