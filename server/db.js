const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// In production set DB_PATH to a persistent-disk location, e.g. /var/data/supportly.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../supportly.db');

// Ensure the directory exists (important on first deploy to a persistent disk)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Performance + safety pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Auto-create schema on first run ──────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    password_hash  TEXT    NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    is_verified    INTEGER NOT NULL DEFAULT 0,
    is_banned      INTEGER NOT NULL DEFAULT 0,
    preferred_role TEXT    CHECK (preferred_role IN ('sharer','listener')),
    preferred_mode TEXT    NOT NULL DEFAULT 'either'
                           CHECK (preferred_mode IN ('text','video','either')),
    last_seen_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sharer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listener_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode        TEXT    NOT NULL CHECK (mode IN ('text','video')),
    status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
    started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at    TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS match_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT    NOT NULL CHECK (role IN ('sharer','listener')),
    mode       TEXT    NOT NULL CHECK (mode IN ('text','video','either')),
    status     TEXT    NOT NULL DEFAULT 'waiting'
                       CHECK (status IN ('waiting','matched','cancelled')),
    match_id   INTEGER REFERENCES matches(id),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS video_readiness (
    match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    ready_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (match_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    reason      TEXT    NOT NULL,
    details     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    sender_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    content    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TRIGGER IF NOT EXISTS users_updated_at
    AFTER UPDATE ON users BEGIN
      UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
    END;

  CREATE TRIGGER IF NOT EXISTS match_queue_updated_at
    AFTER UPDATE ON match_queue BEGIN
      UPDATE match_queue SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
`);

console.log('✓ SQLite ready →', DB_PATH);
module.exports = db;
