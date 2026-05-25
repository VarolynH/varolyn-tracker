-- ============================================================
-- Varolyn Healthcare — Final Production Schema
-- ============================================================

DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS location_points CASCADE;
DROP TABLE IF EXISTS tracking_sessions CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;

-- Admin users (owner only)
CREATE TABLE admin_users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Staff tracking sessions
CREATE TABLE tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         VARCHAR(24) UNIQUE NOT NULL,
  session_secret VARCHAR(32) NOT NULL,

  -- Staff info (phone & email encrypted at rest)
  staff_name    VARCHAR(255) NOT NULL,
  staff_phone_enc TEXT NOT NULL,
  staff_email_enc TEXT NOT NULL,
  designation   VARCHAR(255) DEFAULT '',

  -- Consent
  consent_gps  BOOLEAN     NOT NULL DEFAULT false,
  consent_ip   VARCHAR(45),
  consent_ua   TEXT,
  consent_at   TIMESTAMPTZ,

  -- OSINT
  ip_geo       JSONB DEFAULT '{}',
  device_info  JSONB DEFAULT '{}',

  -- Recipient
  recipient_phone VARCHAR(20),
  recipient_name  VARCHAR(255),

  -- Status: active | stopped | expired
  status       VARCHAR(20) DEFAULT 'active',
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '4 hours'),
  stopped_at   TIMESTAMPTZ,

  -- Cached latest position
  last_lat      DOUBLE PRECISION,
  last_lng      DOUBLE PRECISION,
  last_accuracy REAL,
  last_speed    REAL,
  last_heading  REAL,
  last_update   TIMESTAMPTZ,
  last_battery  JSONB DEFAULT '{}',
  last_network  JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Location breadcrumbs
CREATE TABLE location_points (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  raw_lat     DOUBLE PRECISION,
  raw_lng     DOUBLE PRECISION,
  accuracy    REAL,
  speed       REAL,
  heading     REAL
);

-- Audit log
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  actor      VARCHAR(255),
  target_id  VARCHAR(255),
  ip_address VARCHAR(45),
  details    JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lp_session  ON location_points(session_id, recorded_at DESC);
CREATE INDEX idx_ts_token    ON tracking_sessions(token);
CREATE INDEX idx_ts_active   ON tracking_sessions(status) WHERE status = 'active';
CREATE INDEX idx_ts_secret   ON tracking_sessions(session_secret);
CREATE INDEX idx_audit_time  ON audit_log(created_at DESC);
