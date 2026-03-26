-- ══════════════════════════════════════════
-- Migration 002 — Queue & Matching
-- Run: psql -U postgres -d supportly -f migrations/002_queue_matching.sql
-- ══════════════════════════════════════════

-- matches must be created BEFORE match_queue (FK dependency)
CREATE TABLE IF NOT EXISTS matches (
  id          SERIAL PRIMARY KEY,
  sharer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listener_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('text', 'video')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_sharer   ON matches(sharer_id);
CREATE INDEX IF NOT EXISTS idx_matches_listener ON matches(listener_id);
CREATE INDEX IF NOT EXISTS idx_matches_status   ON matches(status);

-- Queue: one waiting entry per user (enforced by partial unique index)
CREATE TABLE IF NOT EXISTS match_queue (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('sharer', 'listener')),
  mode       TEXT NOT NULL CHECK (mode IN ('text', 'video', 'either')),
  status     TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'cancelled')),
  match_id   INTEGER DEFAULT NULL REFERENCES matches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevents a user from having two active (waiting) queue entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_one_active_per_user
  ON match_queue(user_id) WHERE status = 'waiting';

-- Fast lookup for finding compatible waiting users
CREATE INDEX IF NOT EXISTS idx_queue_waiting
  ON match_queue(role, status) WHERE status = 'waiting';

-- Auto-update updated_at
DROP TRIGGER IF EXISTS match_queue_updated_at ON match_queue;
CREATE TRIGGER match_queue_updated_at
  BEFORE UPDATE ON match_queue
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
