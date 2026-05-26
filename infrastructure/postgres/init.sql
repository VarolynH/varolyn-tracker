-- ============================================================
-- Varolyn Tracker — PostgreSQL + TimescaleDB Schema
-- Runs on first docker-compose up (init script)
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ============================================================
-- 1. USERS & AUTH
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'patient')),
    full_name       TEXT NOT NULL,
    phone           TEXT,
    phone_verified  BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- 2. STAFF PROFILES
-- ============================================================
CREATE TABLE staff_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specialization  TEXT,
    photo_url       TEXT,
    vehicle_type    TEXT CHECK (vehicle_type IN ('walk', 'bike', 'car', 'auto', 'public_transport')),
    push_subscription JSONB,   -- Web Push subscription object
    is_available    BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- ============================================================
-- 3. PATIENTS
-- ============================================================
CREATE TABLE patients (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    full_name       TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    address_line    TEXT,
    address_lat     DOUBLE PRECISION,
    address_lng     DOUBLE PRECISION,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_phone ON patients(phone);

-- ============================================================
-- 4. APPOINTMENTS
-- ============================================================
CREATE TABLE appointments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    staff_id        UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    estimated_duration_min INTEGER DEFAULT 60,
    service_type    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','staff_en_route','arrived','in_progress','completed','cancelled','no_show')),
    destination_lat DOUBLE PRECISION NOT NULL,
    destination_lng DOUBLE PRECISION NOT NULL,
    destination_address TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_staff ON appointments(staff_id);
CREATE INDEX idx_appointments_scheduled ON appointments(scheduled_at);

-- ============================================================
-- 5. TRACKING LINKS (short unique URLs)
-- ============================================================
CREATE TABLE tracking_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id  UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    token           TEXT UNIQUE NOT NULL,              -- short random token (e.g. "v7Kx3m")
    expires_at      TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    consent_given   BOOLEAN DEFAULT FALSE,
    consent_given_at TIMESTAMPTZ,
    patient_ip      INET,
    patient_ua      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(appointment_id)
);

CREATE INDEX idx_tracking_links_token ON tracking_links(token);
CREATE INDEX idx_tracking_links_expires ON tracking_links(expires_at);

-- ============================================================
-- 6. CONSENT CHAIN (immutable append-only, SHA-256 linked)
-- ============================================================
CREATE TABLE consent_chain (
    id              BIGSERIAL PRIMARY KEY,
    appointment_id  UUID NOT NULL REFERENCES appointments(id),
    link_id         UUID NOT NULL REFERENCES tracking_links(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    consent_type    TEXT NOT NULL,                     -- 'gps_tracking', 'ip_collection', 'data_retention'
    granted         BOOLEAN NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    fingerprint     TEXT,                              -- browser fingerprint hash (optional)
    prev_hash       TEXT NOT NULL,                     -- SHA-256 of previous entry (genesis = '0')
    entry_hash      TEXT NOT NULL,                     -- SHA-256(prev_hash + payload)
    payload_json    JSONB NOT NULL,                    -- full consent payload for audit
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_chain_appointment ON consent_chain(appointment_id);
CREATE INDEX idx_consent_chain_hash ON consent_chain(entry_hash);

-- Immutability: revoke UPDATE/DELETE on consent_chain
-- (enforced at application level; DB trigger as extra guard)
CREATE OR REPLACE FUNCTION prevent_consent_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'consent_chain is append-only: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consent_no_update
    BEFORE UPDATE OR DELETE ON consent_chain
    FOR EACH ROW EXECUTE FUNCTION prevent_consent_mutation();

-- ============================================================
-- 7. LOCATION HISTORY (TimescaleDB hypertable)
-- ============================================================
CREATE TABLE location_history (
    time            TIMESTAMPTZ NOT NULL,
    appointment_id  UUID NOT NULL,
    staff_id        UUID NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    accuracy        DOUBLE PRECISION,                  -- meters
    altitude        DOUBLE PRECISION,
    speed           DOUBLE PRECISION,                  -- m/s
    heading         DOUBLE PRECISION,                  -- degrees
    battery_level   DOUBLE PRECISION,                  -- 0-1
    is_foreground   BOOLEAN DEFAULT TRUE,              -- was app in foreground?
    raw_lat         DOUBLE PRECISION,                  -- pre-Kalman
    raw_lng         DOUBLE PRECISION,
    source          TEXT DEFAULT 'gps'
                    CHECK (source IN ('gps','network','ip','interpolated','dead_reckoning'))
);

-- Convert to TimescaleDB hypertable (auto-partitions by time)
SELECT create_hypertable('location_history', 'time',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

CREATE INDEX idx_location_appointment ON location_history(appointment_id, time DESC);
CREATE INDEX idx_location_staff ON location_history(staff_id, time DESC);

-- Automatic data retention policy: drop chunks older than 48 hours
SELECT add_retention_policy('location_history', INTERVAL '48 hours', if_not_exists => TRUE);

-- ============================================================
-- 8. ETA SNAPSHOTS
-- ============================================================
CREATE TABLE eta_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    appointment_id  UUID NOT NULL REFERENCES appointments(id),
    estimated_at    TIMESTAMPTZ DEFAULT NOW(),
    eta_seconds     INTEGER NOT NULL,
    distance_meters INTEGER NOT NULL,
    staff_lat       DOUBLE PRECISION NOT NULL,
    staff_lng       DOUBLE PRECISION NOT NULL,
    dest_lat        DOUBLE PRECISION NOT NULL,
    dest_lng        DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('eta_snapshots', 'estimated_at',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- ============================================================
-- 9. AUDIT LOG (immutable)
-- ============================================================
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        UUID,
    actor_role      TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     UUID,
    details         JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);

-- ============================================================
-- 10. NOTIFICATION LOG
-- ============================================================
CREATE TABLE notification_log (
    id              BIGSERIAL PRIMARY KEY,
    appointment_id  UUID REFERENCES appointments(id),
    recipient_id    UUID,
    channel         TEXT NOT NULL CHECK (channel IN ('web_push','email','sms','telegram','whatsapp')),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','delivered','failed','clicked')),
    payload         JSONB,
    error_message   TEXT,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. DATA PURGE LOG (proves GDPR/DPDP compliance)
-- ============================================================
CREATE TABLE purge_log (
    id              BIGSERIAL PRIMARY KEY,
    purge_type      TEXT NOT NULL,                     -- 'auto_ttl', 'right_to_erasure', 'manual'
    records_deleted INTEGER NOT NULL,
    table_name      TEXT NOT NULL,
    appointment_id  UUID,
    requested_by    UUID,
    executed_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- HELPER: Auto-update updated_at timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_staff_updated BEFORE UPDATE ON staff_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_patients_updated BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_appointments_updated BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED: default admin user (password: admin123 — CHANGE IN PROD)
-- ============================================================
INSERT INTO users (email, password_hash, role, full_name)
VALUES (
    'admin@varolynhealthcare.com',
    -- bcrypt hash of 'admin123'
    '$2b$12$LJ3m5FqKsjHiE0W1kAqIp.1FcGpHdPRL0rCQwKB0GgFaHN6MkH5W2',
    'admin',
    'System Administrator'
) ON CONFLICT (email) DO NOTHING;
