#!/usr/bin/env node
/**
 * Varolyn Tracker — Unit Tests (no Docker required)
 * Tests core logic: Kalman filter, crypto, consent chain, token generation
 *
 * Run: node tests/unit-tests.js
 */

'use strict';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertClose(a, b, tolerance = 0.0001, msg) {
  if (Math.abs(a - b) > tolerance) {
    throw new Error(msg || `Expected ${a} ≈ ${b} (tolerance ${tolerance})`);
  }
}

// ── 1. Kalman Filter Tests ──────────────────────────────
console.log('\n🔬 Kalman Filter Tests');
const { KalmanFilter1D, GPSKalmanFilter, haversineDistance } = require('../services/tracking/src/kalman');

test('KalmanFilter1D initializes with first measurement', () => {
  const kf = new KalmanFilter1D();
  const result = kf.filter(10);
  assert(result === 10, `Expected 10, got ${result}`);
});

test('KalmanFilter1D smooths noisy input', () => {
  const kf = new KalmanFilter1D({ processNoise: 0.01, measurementNoise: 1 });
  kf.filter(10);
  const r1 = kf.filter(10.5);
  const r2 = kf.filter(9.8);
  const r3 = kf.filter(10.2);
  // After smoothing, should be near 10
  assert(Math.abs(r3 - 10) < 1, `Smoothed value ${r3} should be near 10`);
});

test('KalmanFilter1D reset works', () => {
  const kf = new KalmanFilter1D();
  kf.filter(100);
  kf.reset();
  const r = kf.filter(50);
  assert(r === 50, 'After reset, should reinitialize with first measurement');
});

test('GPSKalmanFilter filters 2D coordinates', () => {
  const gkf = new GPSKalmanFilter();
  const r1 = gkf.filter({ lat: 12.9716, lng: 77.5946, accuracy: 5, timestamp: 1000 });
  assert(r1.lat !== undefined && r1.lng !== undefined, 'Should return lat/lng');
  assert(!r1.isOutlier, 'First point should not be outlier');
});

test('GPSKalmanFilter rejects impossible speed outliers', () => {
  const gkf = new GPSKalmanFilter();
  gkf.filter({ lat: 12.9716, lng: 77.5946, accuracy: 5, timestamp: 1000 });
  // Jump 100km in 1 second = impossible
  const r2 = gkf.filter({ lat: 13.9716, lng: 77.5946, accuracy: 5, timestamp: 2000 });
  assert(r2.isOutlier === true, 'Should reject impossible speed jump');
});

test('GPSKalmanFilter accepts normal movement', () => {
  const gkf = new GPSKalmanFilter();
  gkf.filter({ lat: 12.9716, lng: 77.5946, accuracy: 5, timestamp: 1000 });
  // Move ~100m in 10 seconds = ~36km/h (normal driving)
  const r2 = gkf.filter({ lat: 12.9726, lng: 77.5946, accuracy: 5, timestamp: 11000 });
  assert(!r2.isOutlier, 'Normal driving speed should be accepted');
});

test('haversineDistance calculates correctly', () => {
  // Known distance: ~111.2 km between 1 degree of latitude
  const dist = haversineDistance(0, 0, 1, 0);
  assert(dist > 110000 && dist < 112000, `Expected ~111.2km, got ${(dist / 1000).toFixed(1)}km`);
});

test('haversineDistance same point = 0', () => {
  const dist = haversineDistance(12.9716, 77.5946, 12.9716, 77.5946);
  assert(dist === 0, 'Same point distance should be 0');
});

// ── 2. Crypto Tests ──────────────────────────────────────
console.log('\n🔐 Crypto Tests');
// Set required env vars
process.env.JWT_SECRET = 'test-secret-key-for-unit-tests';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
const crypto = require('../shared/crypto');

test('signToken and verifyToken roundtrip', () => {
  const payload = { userId: 'abc', role: 'staff' };
  const token = crypto.signToken(payload, '1h');
  assert(typeof token === 'string', 'Token should be a string');
  const decoded = crypto.verifyToken(token);
  assert(decoded.userId === 'abc', 'Decoded userId should match');
  assert(decoded.role === 'staff', 'Decoded role should match');
});

test('verifyToken rejects invalid token', () => {
  try {
    crypto.verifyToken('invalid.token.here');
    assert(false, 'Should have thrown');
  } catch (err) {
    assert(err.name === 'JsonWebTokenError', 'Should throw JWT error');
  }
});

test('hashPassword and comparePassword', async () => {
  const hash = await crypto.hashPassword('mypassword123');
  assert(typeof hash === 'string', 'Hash should be a string');
  assert(hash.startsWith('$2'), 'Should be bcrypt hash');
  const match = await crypto.comparePassword('mypassword123', hash);
  assert(match === true, 'Correct password should match');
  const noMatch = await crypto.comparePassword('wrongpassword', hash);
  assert(noMatch === false, 'Wrong password should not match');
});

test('encrypt and decrypt roundtrip', () => {
  const plaintext = 'Hello, Varolyn Healthcare!';
  const encrypted = crypto.encrypt(plaintext);
  assert(typeof encrypted === 'string', 'Encrypted should be a string');
  assert(encrypted.includes(':'), 'Should contain IV:tag:data format');
  const decrypted = crypto.decrypt(encrypted);
  assert(decrypted === plaintext, `Decrypted '${decrypted}' should match original`);
});

test('encrypt produces different output each time (random IV)', () => {
  const e1 = crypto.encrypt('test');
  const e2 = crypto.encrypt('test');
  assert(e1 !== e2, 'Same plaintext should produce different ciphertext (random IV)');
});

test('sha256 produces consistent hash', () => {
  const h1 = crypto.sha256('hello');
  const h2 = crypto.sha256('hello');
  assert(h1 === h2, 'Same input should produce same hash');
  assert(h1.length === 64, 'SHA-256 hex should be 64 chars');
});

test('computeConsentHash chains correctly', () => {
  const genesis = '0';
  const payload1 = { consent_type: 'gps', granted: true };
  const hash1 = crypto.computeConsentHash(genesis, payload1);
  assert(typeof hash1 === 'string' && hash1.length === 64, 'Should produce valid hash');

  const payload2 = { consent_type: 'ip', granted: true };
  const hash2 = crypto.computeConsentHash(hash1, payload2);
  assert(hash2 !== hash1, 'Different payloads should produce different hashes');

  // Verify deterministic
  const hash2Again = crypto.computeConsentHash(hash1, payload2);
  assert(hash2 === hash2Again, 'Same inputs should produce same hash');
});

test('computeConsentHash is order-independent for keys', () => {
  const prevHash = 'abc123';
  const payload1 = { a: 1, b: 2 };
  const payload2 = { b: 2, a: 1 };
  const h1 = crypto.computeConsentHash(prevHash, payload1);
  const h2 = crypto.computeConsentHash(prevHash, payload2);
  assert(h1 === h2, 'Key order should not affect hash (canonical JSON)');
});

test('generateTrackingToken produces unique tokens', () => {
  const t1 = crypto.generateTrackingToken();
  const t2 = crypto.generateTrackingToken();
  assert(t1 !== t2, 'Tokens should be unique');
  assert(t1.length === 8, 'Default length should be 8');
  assert(/^[A-Za-z0-9]+$/.test(t1), 'Should only contain alphanumeric chars');
});

test('generateTrackingToken custom length', () => {
  const t = crypto.generateTrackingToken(12);
  assert(t.length === 12, 'Custom length should be respected');
});

test('hmacSign and hmacVerify', () => {
  const payload = 'important data';
  const sig = crypto.hmacSign(payload);
  assert(typeof sig === 'string', 'Signature should be a string');
  const valid = crypto.hmacVerify(payload, sig);
  assert(valid === true, 'Valid signature should verify');
});

// ── 3. Consent Chain Integrity Tests ─────────────────────
console.log('\n⛓️ Consent Chain Integrity Tests');

test('Full consent chain simulation', () => {
  let prevHash = '0'; // Genesis

  const entries = [
    { consent_type: 'gps_tracking', granted: true, patient: 'P001', ts: '2024-01-01T10:00:00Z' },
    { consent_type: 'ip_collection', granted: true, patient: 'P001', ts: '2024-01-01T10:00:01Z' },
    { consent_type: 'data_retention', granted: false, patient: 'P001', ts: '2024-01-01T10:00:02Z' },
  ];

  const chain = [];
  for (const entry of entries) {
    const entryHash = crypto.computeConsentHash(prevHash, entry);
    chain.push({ ...entry, prevHash, entryHash });
    prevHash = entryHash;
  }

  assert(chain.length === 3, 'Chain should have 3 entries');
  assert(chain[0].prevHash === '0', 'First entry should reference genesis');
  assert(chain[1].prevHash === chain[0].entryHash, 'Second should reference first hash');
  assert(chain[2].prevHash === chain[1].entryHash, 'Third should reference second hash');

  // Verify chain
  let valid = true;
  for (let i = 0; i < chain.length; i++) {
    const expected = i === 0 ? '0' : chain[i - 1].entryHash;
    if (chain[i].prevHash !== expected) { valid = false; break; }
    const recomputed = crypto.computeConsentHash(chain[i].prevHash, {
      consent_type: chain[i].consent_type,
      granted: chain[i].granted,
      patient: chain[i].patient,
      ts: chain[i].ts,
    });
    if (recomputed !== chain[i].entryHash) { valid = false; break; }
  }
  assert(valid, 'Chain verification should pass');
});

test('Tampered chain is detected', () => {
  let prevHash = '0';
  const payload = { consent_type: 'gps', granted: true };
  const hash1 = crypto.computeConsentHash(prevHash, payload);

  // Tamper: change the payload after hashing
  const tamperedPayload = { consent_type: 'gps', granted: false };
  const recomputed = crypto.computeConsentHash(prevHash, tamperedPayload);
  assert(recomputed !== hash1, 'Tampered payload should produce different hash');
});

// ── 4. Database Schema Validation ────────────────────────
console.log('\n🗄️ Schema Validation');

const fs = require('fs');
const initSql = fs.readFileSync('./infrastructure/postgres/init.sql', 'utf8');

test('Init SQL contains all required tables', () => {
  const tables = [
    'users', 'staff_profiles', 'patients', 'appointments',
    'tracking_links', 'consent_chain', 'location_history',
    'eta_snapshots', 'audit_log', 'notification_log', 'purge_log',
  ];
  for (const table of tables) {
    assert(initSql.includes(`CREATE TABLE ${table}`), `Missing table: ${table}`);
  }
});

test('Init SQL creates TimescaleDB hypertables', () => {
  assert(initSql.includes("create_hypertable('location_history'"), 'Missing location_history hypertable');
  assert(initSql.includes("create_hypertable('eta_snapshots'"), 'Missing eta_snapshots hypertable');
});

test('Init SQL has consent mutation prevention trigger', () => {
  assert(initSql.includes('prevent_consent_mutation'), 'Missing consent immutability trigger');
});

test('Init SQL has retention policy', () => {
  assert(initSql.includes('add_retention_policy'), 'Missing automatic retention policy');
});

test('Init SQL has default admin user seed', () => {
  assert(initSql.includes("admin@varolynhealthcare.com"), 'Missing admin user seed');
});

// ── 5. Service Worker Validation ─────────────────────────
console.log('\n🔧 Service Worker Validation');

const swJs = fs.readFileSync('./web/staff-pwa/public/sw.js', 'utf8');

test('SW handles push events', () => {
  assert(swJs.includes("addEventListener('push'"), 'Missing push event listener');
});

test('SW handles notification clicks', () => {
  assert(swJs.includes("addEventListener('notificationclick'"), 'Missing notificationclick listener');
});

test('SW handles periodic sync', () => {
  assert(swJs.includes("addEventListener('periodicsync'"), 'Missing periodicsync listener');
});

test('SW handles background sync', () => {
  assert(swJs.includes("addEventListener('sync'"), 'Missing sync listener');
});

test('SW uses IndexedDB for offline buffering', () => {
  assert(swJs.includes('indexedDB'), 'Missing IndexedDB usage');
});

test('SW sends RESUME_TRACKING message', () => {
  assert(swJs.includes('RESUME_TRACKING'), 'Missing RESUME_TRACKING message');
});

// ── 6. Consent Screen Validation ─────────────────────────
console.log('\n📋 Consent Screen Validation');

const consentScreen = fs.readFileSync('./web/customer-pwa/src/components/ConsentScreen.jsx', 'utf8');

test('Consent screen has granular toggles', () => {
  assert(consentScreen.includes('gps_tracking'), 'Missing gps_tracking toggle');
  assert(consentScreen.includes('ip_collection'), 'Missing ip_collection toggle');
  assert(consentScreen.includes('data_retention'), 'Missing data_retention toggle');
});

test('Consent screen shows DPDP/GDPR references', () => {
  assert(consentScreen.includes('DPDP'), 'Missing DPDP reference');
  assert(consentScreen.includes('GDPR'), 'Missing GDPR reference');
});

test('Consent screen has right to erasure info', () => {
  assert(consentScreen.includes('Right to erasure'), 'Missing right to erasure info');
});

test('Consent screen has legal entity info', () => {
  assert(consentScreen.includes('Varolyn Healthcare'), 'Missing data controller info');
});

// ── 7. Docker Compose Validation ─────────────────────────
console.log('\n🐳 Docker Compose Validation');

const dc = fs.readFileSync('./infrastructure/docker-compose.yml', 'utf8');

test('Docker Compose has all services', () => {
  const services = ['postgres', 'redis', 'traefik', 'gateway', 'tracking', 'consent',
    'appointment', 'link', 'notification', 'audit', 'admin',
    'customer-pwa', 'staff-pwa', 'admin-dashboard'];
  for (const svc of services) {
    assert(dc.includes(`${svc}:`), `Missing service: ${svc}`);
  }
});

test('Docker Compose has health checks', () => {
  assert(dc.includes('healthcheck'), 'Missing health checks');
});

test('Docker Compose has monitoring profiles', () => {
  assert(dc.includes('prometheus'), 'Missing prometheus');
  assert(dc.includes('grafana'), 'Missing grafana');
});

// ── 8. API Spec Validation ───────────────────────────────
console.log('\n📡 API Spec Validation');

const apiSpec = fs.readFileSync('./docs/api-spec.yaml', 'utf8');

test('API spec has all key endpoints', () => {
  assert(apiSpec.includes('/auth/login'), 'Missing auth login');
  assert(apiSpec.includes('/appointments'), 'Missing appointments');
  assert(apiSpec.includes('/consent/grant'), 'Missing consent grant');
  assert(apiSpec.includes('/consent/revoke'), 'Missing consent revoke');
  assert(apiSpec.includes('/link/resolve'), 'Missing link resolve');
  assert(apiSpec.includes('/notifications/subscribe'), 'Missing push subscribe');
  assert(apiSpec.includes('/notifications/vapid-key'), 'Missing vapid key');
});

// ── Results ──────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n  🎉 All tests passed!\n');
}
