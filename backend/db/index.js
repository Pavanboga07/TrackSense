'use strict';

const path = require('path');
const fs   = require('fs');

const DB_PATH = path.resolve(process.env.DB_PATH || './analytics.db');

let _db = null;

/**
 * Async init — call once at startup and await before app.listen().
 * Loads existing DB from disk or creates a fresh one, then runs migrations.
 */
async function init() {
  const initSqlJs = require('sql.js');
  const SQL       = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    _db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new SQL.Database();
  }

  // Foreign-key enforcement (must be set on every open)
  _db.run('PRAGMA foreign_keys = ON');

  const migSQL = fs.readFileSync(
    path.join(__dirname, 'migrations/001_init.sql'),
    'utf8'
  );
  _db.exec(migSQL);
  persist(); // write initial schema to disk

  console.log(`[DB] sql.js initialized → ${DB_PATH}`);
}

/**
 * Flush the in-memory database to disk.
 * Call after every write operation.
 */
function persist() {
  const data = _db.export();
  const dir  = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Wrap multiple write operations in a single SQLite transaction.
 * Automatically commits or rolls back.
 */
function transaction(fn) {
  _db.run('BEGIN');
  try {
    fn();
    _db.run('COMMIT');
  } catch (err) {
    try { _db.run('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

/** Execute a write statement. Returns the number of modified rows. */
function run(sql, params) {
  _db.run(sql, params);
  return _db.getRowsModified();
}

/** Return the first matching row as a plain object, or undefined. */
function get(sql, params) {
  const stmt = _db.prepare(sql);
  if (params) stmt.bind(params);
  let row;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

/** Return all matching rows as plain objects. */
function all(sql, params) {
  const stmt = _db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

module.exports = { init, persist, transaction, run, get, all };
