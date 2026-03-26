-- ══════════════════════════════════════════
-- Supportly — Database Schema
-- Run once: psql -U postgres -d supportly -f schema.sql
-- ══════════════════════════════════════════

-- Users
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_role  TEXT CHECK (preferred_role IN ('sharer', 'listener')) DEFAULT NULL,
  preferred_mode  TEXT CHECK (preferred_mode IN ('text', 'video', 'either')) DEFAULT 'either',
  last_seen_at    TIMESTAMPTZ DEFAULT NULL
);

-- Sessions (managed by connect-pg-simple)
CREATE TABLE IF NOT EXISTS sessions (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON    NOT NULL,
  expire TIMESTAMP(6) NOT NULL
) WITH (OIDS=FALSE);

ALTER TABLE sessions
  ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid)
  NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);

-- Auto-update updated_at on users
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON users;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
