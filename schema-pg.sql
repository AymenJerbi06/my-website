-- Supportly — PostgreSQL schema
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT      UNIQUE NOT NULL,
  password_hash  TEXT      NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_verified    BOOLEAN   NOT NULL DEFAULT FALSE,
  is_banned      BOOLEAN   NOT NULL DEFAULT FALSE,
  preferred_role TEXT      CHECK (preferred_role IN ('sharer','listener')),
  preferred_mode TEXT      NOT NULL DEFAULT 'either'
                            CHECK (preferred_mode IN ('text','video','either')),
  last_seen_at          TIMESTAMPTZ,
  active_session_token  TEXT
);

-- Add column to existing deployments that pre-date it
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_token TEXT;

CREATE TABLE IF NOT EXISTS matches (
  id          BIGSERIAL PRIMARY KEY,
  sharer_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listener_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode        TEXT   NOT NULL CHECK (mode IN ('text','video')),
  status      TEXT   NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_queue (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT   NOT NULL CHECK (role IN ('sharer','listener')),
  mode       TEXT   NOT NULL CHECK (mode IN ('text','video','either')),
  status     TEXT   NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting','matched','cancelled')),
  match_id   BIGINT REFERENCES matches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_readiness (
  match_id   BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  ready_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          BIGSERIAL PRIMARY KEY,
  match_id    BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  reporter_id BIGINT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  reason      TEXT   NOT NULL,
  details     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  match_id   BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id  BIGINT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  content    TEXT   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on users
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_updated_at') THEN
    CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'match_queue_updated_at') THEN
    CREATE TRIGGER match_queue_updated_at BEFORE UPDATE ON match_queue
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
