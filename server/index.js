'use strict';

// Prevent unhandled errors from silently crashing
process.on('uncaughtException', (e) => { console.error('[FATAL] Uncaught:', e.message, e.stack); });
process.on('unhandledRejection', (e) => { console.error('[FATAL] Unhandled rejection:', e?.message || e); });

const Fastify    = require('fastify');
const cors       = require('@fastify/cors');
const helmet     = require('@fastify/helmet');
const rateLimit  = require('@fastify/rate-limit');
const ws         = require('@fastify/websocket');
const { Pool }   = require('pg');
const Redis      = require('ioredis');
const cryptoNode = require('crypto');
const http       = require('http');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const path       = require('path');
const fs         = require('fs');
const { GPSKalmanFilter } = require('./kalman');

// ═══════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════
const PORT       = parseInt(process.env.PORT || '8080');
const JWT_SECRET = process.env.JWT_SECRET || cryptoNode.randomBytes(32).toString('hex');
const ENC_KEY    = Buffer.from(
  (process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  'hex'
);
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@varolynhealthcare.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ZOHO_WEBHOOK   = process.env.ZOHO_CRM_WEBHOOK_URL || '';

// Warn if using default secrets in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET) console.warn('[SECURITY] JWT_SECRET not set — using random (tokens will invalidate on restart)');
  if (!process.env.ENCRYPTION_KEY) console.warn('[SECURITY] ENCRYPTION_KEY not set — using default (DATA IS NOT SECURE!)');
  if (ADMIN_PASSWORD === 'admin123') console.warn('[SECURITY] ADMIN_PASSWORD is default — CHANGE IT IMMEDIATELY!');
}

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 20, statement_timeout: 10000 }
  : {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'varolyn_tracker',
      user: process.env.POSTGRES_USER || process.env.USER,
      password: process.env.POSTGRES_PASSWORD || '',
      max: 20, statement_timeout: 10000, idle_timeout: 30000,
      ...(process.env.POSTGRES_HOST && process.env.POSTGRES_HOST !== 'localhost'
        ? { ssl: { rejectUnauthorized: false } } : {}),
    };
const db = new Pool(dbConfig);

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisOpts = {
  lazyConnect: true, maxRetriesPerRequest: 3, retryStrategy: (times) => Math.min(times * 500, 5000),
  ...(REDIS_URL.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}),
};
const redisPub = new Redis(REDIS_URL, redisOpts);
const redisSub = new Redis(REDIS_URL, redisOpts);

// CRITICAL: Attach error handlers to prevent unhandled error crashes
redisPub.on('error', (e) => console.warn('[REDIS-PUB] Error:', e.message));
redisSub.on('error', (e) => console.warn('[REDIS-SUB] Error:', e.message));

const kalmanFilters = new Map();
const sseClients    = new Map();

// ═══════════════════════════════════════════════════════
//  SECURITY UTILITIES
// ═══════════════════════════════════════════════════════

function genToken(len = 16) {
  return cryptoNode.randomBytes(len).toString('base64url').slice(0, len);
}

/** AES-256-GCM encrypt */
function encrypt(text) {
  const iv = cryptoNode.randomBytes(16);
  const cipher = cryptoNode.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  let enc = cipher.update(String(text), 'utf8', 'hex');
  enc += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

/** AES-256-GCM decrypt */
function decrypt(data) {
  try {
    const [ivH, tagH, encH] = data.split(':');
    const dec = cryptoNode.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivH, 'hex'));
    dec.setAuthTag(Buffer.from(tagH, 'hex'));
    let out = dec.update(encH, 'hex', 'utf8');
    out += dec.final('utf8');
    return out;
  } catch { return '[encrypted]'; }
}

/** Strip HTML/script to prevent XSS */
function sanitize(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`&;{}()]/g, '').trim().slice(0, maxLen);
}

/** Validate token format (only base64url chars) */
function isValidToken(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{6,24}$/.test(t);
}

/** Timing-safe string comparison (prevents timing attacks on secrets) */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return cryptoNode.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Audit log */
async function auditLog(eventType, actor, targetId, ip, details = {}) {
  try {
    await db.query(
      `INSERT INTO audit_log (event_type, actor, target_id, ip_address, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [eventType, actor || null, targetId || null, ip || null, JSON.stringify(details)]);
  } catch {}
}

// ═══════════════════════════════════════════════════════
//  ADMIN AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════

function requireAdmin(req, reply, done) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    if (decoded.role !== 'admin') { reply.code(403).send({ error: 'Forbidden' }); return; }
    req.adminId = decoded.id;
    req.adminEmail = decoded.email;
    done();
  } catch {
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}

// ═══════════════════════════════════════════════════════
//  OSINT UTILITIES
// ═══════════════════════════════════════════════════════

function ipGeoLookup(ip) {
  return new Promise((resolve) => {
    const clean = (ip || '').replace('::ffff:', '');
    if (!clean || clean === '127.0.0.1' || clean === '::1' ||
        /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(clean)) {
      resolve({ status: 'local', query: clean, city: 'Local Network',
        regionName: '', country: 'Local', countryCode: '', lat: 0, lon: 0,
        timezone: '', isp: 'Local', org: '', mobile: false, proxy: false, hosting: false });
      return;
    }
    const url = `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query`;
    http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ status: 'fail' }); } });
    }).on('error', () => resolve({ status: 'fail', query: clean }));
  });
}

function parseUA(ua) {
  if (!ua) return { device: 'Unknown', os: 'Unknown', browser: 'Unknown' };
  let device = 'Desktop', os = 'Unknown', browser = 'Unknown';
  if (/iPhone/i.test(ua)) device = 'iPhone';
  else if (/iPad/i.test(ua)) device = 'iPad';
  else if (/Android/i.test(ua)) { const m = ua.match(/Android[\s\d.]+;\s*(.+?)\)/); device = m ? m[1].split(' Build')[0].trim() : 'Android'; }
  else if (/Macintosh/i.test(ua)) device = 'Mac';
  else if (/Windows/i.test(ua)) device = 'Windows PC';
  if (/iPhone|iPad|iPod/i.test(ua)) { const v = ua.match(/OS (\d+[_.\d]*)/); os = v ? `iOS ${v[1].replace(/_/g,'.')}` : 'iOS'; }
  else if (/Android/i.test(ua)) { const v = ua.match(/Android (\d+[.\d]*)/); os = v ? `Android ${v[1]}` : 'Android'; }
  else if (/Mac OS X/i.test(ua)) { const v = ua.match(/Mac OS X (\d+[_.\d]*)/); os = v ? `macOS ${v[1].replace(/_/g,'.')}` : 'macOS'; }
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua)) browser = 'Opera';
  else if (/Chrome\/\d/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  return { device, os, browser };
}

// ═══════════════════════════════════════════════════════
//  ZOHO CRM WEBHOOK
// ═══════════════════════════════════════════════════════

async function fireZohoWebhook(event, data) {
  if (!ZOHO_WEBHOOK) return;
  try {
    const payload = JSON.stringify({ event, timestamp: new Date().toISOString(), ...data });
    const u = new URL(ZOHO_WEBHOOK);
    const options = {
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: 'POST', timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const mod = u.protocol === 'https:' ? require('https') : http;
    const r = mod.request(options, () => {});
    r.on('error', () => {});
    r.write(payload);
    r.end();
  } catch {}
}

// ═══════════════════════════════════════════════════════
//  BUILD APP
// ═══════════════════════════════════════════════════════
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  bodyLimit: 16384,          // 16KB max body
  requestTimeout: 30000,
  trustProxy: true,
});

async function build() {
  // ── Security headers ──
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'http://ip-api.com', 'https://*.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
        workerSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
    xPermittedCrossDomainPolicies: false,
  });

  // Add request ID for audit tracing
  app.addHook('onRequest', (req, reply, done) => {
    req.requestId = cryptoNode.randomBytes(8).toString('hex');
    reply.header('X-Request-Id', req.requestId);
    done();
  });

  // ── Rate limiting ──
  await app.register(rateLimit, {
    max: 100, timeWindow: '1 minute',
    keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
  });

  // ── CORS ──
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  await app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST'],
  });

  await app.register(ws);

  // ── Serve static frontend (production build) ──
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    await app.register(require('@fastify/static'), { root: publicDir, prefix: '/' });
    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/') || req.url.startsWith('/sse/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      reply.sendFile('index.html');
    });
  }

  // ── Sanitize all error responses ──
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || 500;
    reply.code(status).send({
      error: status >= 500 ? 'Internal server error' : (err.message || 'Error'),
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // ═════════════════════════════════════════════════════
  //  ADMIN AUTH
  // ═════════════════════════════════════════════════════

  app.post('/api/admin/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) return reply.code(400).send({ error: 'Email and password required' });

    const { rows } = await db.query('SELECT id, email, password_hash FROM admin_users WHERE email=$1', [email]);
    if (rows.length === 0) {
      // Hash a dummy password to prevent timing-based user enumeration
      await bcrypt.compare(password, '$2a$12$000000000000000000000uGDJqHjS2tBbJwFAXkYZPtYnVCiT3sS');
      await auditLog('admin_login_failed', email, null, req.ip, { reason: 'user_not_found' });
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) {
      await auditLog('admin_login_failed', email, null, req.ip, { reason: 'wrong_password' });
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: rows[0].id, email: rows[0].email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    await auditLog('admin_login', rows[0].email, rows[0].id, req.ip);
    return { success: true, token, expiresIn: '8h' };
  });

  // ═════════════════════════════════════════════════════
  //  STAFF ENDPOINTS
  // ═════════════════════════════════════════════════════

  /** POST /api/start — Staff starts tracking session */
  app.post('/api/start', async (req, reply) => {
    const { staffName, staffPhone, staffEmail, designation, consentGps, deviceInfo } = req.body || {};

    const name  = sanitize(staffName);
    const phone = sanitize(staffPhone, 20);
    const email = sanitize(staffEmail);
    const desig = sanitize(designation || '');

    if (!name || !phone || !email)
      return reply.code(400).send({ error: 'Name, phone and email are required' });
    if (!consentGps)
      return reply.code(400).send({ error: 'GPS consent is required' });
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email))
      return reply.code(400).send({ error: 'Invalid email format' });

    const token         = genToken(16);
    const sessionSecret = genToken(24);
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const ua = req.headers['user-agent'] || '';

    const ipGeo    = await ipGeoLookup(ip);
    const parsedUA = parseUA(ua);

    // Sanitize device info — only allow known safe keys
    const safeDeviceInfo = {};
    if (deviceInfo && typeof deviceInfo === 'object') {
      for (const k of ['platform','language','screen','pixelRatio','timezone','cpuCores',
                        'deviceMemory','touchPoints','online','battery','network']) {
        if (deviceInfo[k] !== undefined) safeDeviceInfo[k] = deviceInfo[k];
      }
    }
    safeDeviceInfo.parsedUA = parsedUA;
    safeDeviceInfo.clientIP = ip;

    // Encrypt PII
    const phoneEnc = encrypt(phone);
    const emailEnc = encrypt(email);

    const { rows } = await db.query(
      `INSERT INTO tracking_sessions
         (token, session_secret, staff_name, staff_phone_enc, staff_email_enc, designation,
          consent_gps, consent_ip, consent_ua, consent_at, ip_geo, device_info)
       VALUES ($1,$2,$3,$4,$5,$6, true,$7,$8,NOW(),$9,$10)
       RETURNING id, token, session_secret, expires_at`,
      [token, sessionSecret, name, phoneEnc, emailEnc, desig,
       ip, ua, JSON.stringify(ipGeo), JSON.stringify(safeDeviceInfo)]);

    await auditLog('session_started', name, rows[0].id, ip, { designation: desig });

    fireZohoWebhook('session_started', {
      staffName: name, staffPhone: phone, staffEmail: email,
      designation: desig, trackingToken: token,
    });

    return {
      success: true,
      token:         rows[0].token,
      sessionSecret: rows[0].session_secret,
      sessionId:     rows[0].id,
      expiresAt:     rows[0].expires_at,
    };
  });

  // NOTE: Staff CANNOT stop their own session — only admin can stop tracking.
  // The old /api/stop endpoint has been removed. Admin uses /api/admin/stop-session.

  // ═════════════════════════════════════════════════════
  //  OFFLINE BUFFER — batch sync when staff comes back online
  // ═════════════════════════════════════════════════════

  app.post('/api/batch-locations', async (req, reply) => {
    const { token, sessionSecret, locations } = req.body || {};
    if (!token || !sessionSecret || !Array.isArray(locations) || locations.length === 0)
      return reply.code(400).send({ error: 'Invalid batch data' });
    if (!isValidToken(token))
      return reply.code(400).send({ error: 'Invalid token' });

    // Verify session + secret
    const sess = await db.query(
      `SELECT id, session_secret FROM tracking_sessions WHERE token=$1 AND status='active'`, [token]);
    if (sess.rows.length === 0 || !safeCompare(sess.rows[0].session_secret, sessionSecret))
      return reply.code(404).send({ error: 'Session not found' });

    const sessionId = sess.rows[0].id;
    if (!kalmanFilters.has(token)) kalmanFilters.set(token, new GPSKalmanFilter());
    const kf = kalmanFilters.get(token);

    // Process all buffered locations
    const vals = []; const phs = []; let n = 1;
    let lastFiltered = null;

    for (const loc of locations.slice(0, 500)) { // max 500 points per batch
      if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue;
      if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) continue;

      const ts = loc.ts || Date.now();
      const f = kf.filter({ lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy || 10, speed: loc.speed || 0, timestamp: ts });
      if (f.isOutlier) continue;

      phs.push(`($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`);
      vals.push(sessionId, new Date(ts), f.lat, f.lng, loc.lat, loc.lng,
                loc.accuracy || null, loc.speed || null, loc.heading || null);
      lastFiltered = { f, loc, ts };
    }

    if (phs.length > 0) {
      try {
        await db.query(
          `INSERT INTO location_points (session_id,recorded_at,lat,lng,raw_lat,raw_lng,accuracy,speed,heading) VALUES ${phs.join(',')}`, vals);
      } catch {}
    }

    // Update session with latest location
    if (lastFiltered) {
      const { f, loc } = lastFiltered;
      await db.query(
        `UPDATE tracking_sessions
         SET last_lat=$1, last_lng=$2, last_accuracy=$3, last_speed=$4, last_heading=$5,
             last_update=NOW(),
             last_battery=COALESCE($6::jsonb, last_battery),
             last_network=COALESCE($7::jsonb, last_network)
         WHERE token=$8`,
        [f.lat, f.lng, loc.accuracy, loc.speed, loc.heading,
         loc.battery ? JSON.stringify(loc.battery) : null,
         loc.network ? JSON.stringify(loc.network) : null, token]);

      // Publish latest to SSE customers
      await redisPub.publish(`tracking:${token}`, JSON.stringify({
        type: 'location_update', lat: f.lat, lng: f.lng,
        accuracy: loc.accuracy, speed: loc.speed, heading: loc.heading,
        battery: loc.battery, network: loc.network, timestamp: Date.now(),
      }));
    }

    await auditLog('batch_sync', null, token, req.ip, { count: phs.length });
    return { success: true, synced: phs.length };
  });

  // ═════════════════════════════════════════════════════
  //  CUSTOMER ENDPOINTS (public, minimal data)
  // ═════════════════════════════════════════════════════

  /** GET /api/track/:token — Customer gets ONLY safe public data */
  app.get('/api/track/:token', async (req, reply) => {
    const { token } = req.params;
    if (!isValidToken(token)) return reply.code(400).send({ error: 'Invalid token' });

    await db.query(`UPDATE tracking_sessions SET status='expired', stopped_at=NOW() WHERE status='active' AND expires_at < NOW()`);

    const { rows } = await db.query(
      `SELECT staff_name, designation, status, started_at, expires_at,
              last_lat, last_lng, last_accuracy, last_speed, last_heading,
              last_update, last_battery, last_network
       FROM tracking_sessions WHERE token=$1`, [token]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Tracking link not found' });
    const s = rows[0];
    if (s.status !== 'active')
      return reply.code(410).send({ error: 'Tracking session has ended', status: s.status });

    // Customer sees ONLY: name, designation, location, battery level, network type
    return {
      staffName:   s.staff_name,
      designation: s.designation,
      status:      s.status,
      expiresAt:   s.expires_at,
      location: s.last_lat != null ? {
        lat: s.last_lat, lng: s.last_lng,
        accuracy: s.last_accuracy, speed: s.last_speed,
        heading: s.last_heading, updatedAt: s.last_update,
      } : null,
      battery: s.last_battery?.level != null ? { level: s.last_battery.level } : {},
      network: s.last_network?.type  ? { type: s.last_network.type } : {},
    };
  });

  // ═════════════════════════════════════════════════════
  //  ADMIN DASHBOARD (protected)
  // ═════════════════════════════════════════════════════

  app.get('/api/dashboard', { preHandler: requireAdmin }, async (req, reply) => {
    await db.query(`UPDATE tracking_sessions SET status='expired', stopped_at=NOW() WHERE status='active' AND expires_at < NOW()`);

    const { rows } = await db.query(
      `SELECT id, token, staff_name, staff_phone_enc, staff_email_enc, designation,
              status, started_at, expires_at, stopped_at,
              last_lat, last_lng, last_accuracy, last_speed, last_heading,
              last_update, last_battery, last_network,
              ip_geo, device_info, created_at
       FROM tracking_sessions
       ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 50`);

    await auditLog('dashboard_viewed', req.adminEmail, null, req.ip);

    return {
      sessions: rows.map(s => ({
        id:          s.id,
        token:       s.token,
        staffName:   s.staff_name,
        staffPhone:  decrypt(s.staff_phone_enc),
        staffEmail:  decrypt(s.staff_email_enc),
        designation: s.designation || '',
        status:      s.status,
        startedAt:   s.started_at,
        expiresAt:   s.expires_at,
        stoppedAt:   s.stopped_at,
        location: s.last_lat != null ? {
          lat: s.last_lat, lng: s.last_lng,
          accuracy: s.last_accuracy, speed: s.last_speed,
          heading: s.last_heading, updatedAt: s.last_update,
        } : null,
        battery:    s.last_battery || {},
        network:    s.last_network || {},
        ipGeo:      s.ip_geo || {},
        deviceInfo: s.device_info || {},
      })),
    };
  });

  /** Admin force-stops any session */
  app.post('/api/admin/stop-session', { preHandler: requireAdmin }, async (req, reply) => {
    const { token } = req.body || {};
    if (!token || !isValidToken(token)) return reply.code(400).send({ error: 'Invalid token' });

    const { rowCount } = await db.query(
      `UPDATE tracking_sessions SET status='stopped', stopped_at=NOW()
       WHERE token=$1 AND status='active'`, [token]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Session not found' });

    await redisPub.publish(`tracking:${token}`, JSON.stringify({ type: 'session_ended' }));
    kalmanFilters.delete(token);
    await auditLog('admin_stop_session', req.adminEmail, token, req.ip);
    fireZohoWebhook('session_stopped', { trackingToken: token, stoppedBy: req.adminEmail });
    return { success: true };
  });

  /** Admin updates session duration (extends/shortens expiry) */
  app.post('/api/admin/update-duration', { preHandler: requireAdmin }, async (req, reply) => {
    const { token, hours } = req.body || {};
    if (!token || !isValidToken(token)) return reply.code(400).send({ error: 'Invalid token' });
    if (typeof hours !== 'number' || hours <= 0 || hours > 720)
      return reply.code(400).send({ error: 'Hours must be between 0.5 and 720 (30 days)' });

    const { rowCount } = await db.query(
      `UPDATE tracking_sessions
       SET expires_at = started_at + ($1 || ' hours')::INTERVAL
       WHERE token=$2 AND status='active'`,
      [String(hours), token]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Session not found' });

    await auditLog('admin_update_duration', req.adminEmail, token, req.ip, { hours });
    return { success: true };
  });

  // ═════════════════════════════════════════════════════
  //  WEBSOCKET (staff → server, requires sessionSecret)
  // ═════════════════════════════════════════════════════

  app.register(async function wsPlugin(fastify) {
    fastify.get('/ws/:token', { websocket: true }, async (socket, req) => {
      const { token } = req.params;
      if (!isValidToken(token)) { socket.close(4000); return; }

      const sess = await db.query(
        `SELECT id, session_secret FROM tracking_sessions WHERE token=$1 AND status='active'`, [token]);
      if (sess.rows.length === 0) {
        socket.send(JSON.stringify({ error: 'Invalid or expired session' }));
        socket.close(4004); return;
      }

      const sessionId     = sess.rows[0].id;
      const expectedSecret = sess.rows[0].session_secret;
      let authenticated = false;

      if (!kalmanFilters.has(token)) kalmanFilters.set(token, new GPSKalmanFilter());
      const kf = kalmanFilters.get(token);

      socket.send(JSON.stringify({ type: 'auth_required' }));

      // Timeout: disconnect if not authenticated within 10s
      const authTimeout = setTimeout(() => {
        if (!authenticated) { socket.close(4001); }
      }, 10000);

      const buf = [];
      const flush = async () => {
        if (buf.length === 0) return;
        const batch = buf.splice(0);
        const vals = []; const phs = []; let n = 1;
        for (const p of batch) {
          phs.push(`($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`);
          vals.push(sessionId, new Date(p.ts), p.lat, p.lng, p.rawLat, p.rawLng, p.accuracy, p.speed, p.heading);
        }
        try {
          await db.query(`INSERT INTO location_points (session_id,recorded_at,lat,lng,raw_lat,raw_lng,accuracy,speed,heading) VALUES ${phs.join(',')}`, vals);
        } catch {}
      };
      let flushTimer = null;

      socket.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          // Auth message
          if (!authenticated) {
            if (msg.type === 'auth' && safeCompare(msg.sessionSecret || '', expectedSecret)) {
              authenticated = true;
              clearTimeout(authTimeout);
              flushTimer = setInterval(flush, 5000);
              socket.send(JSON.stringify({ type: 'connected', token }));

              // Subscribe to admin stop commands via Redis so staff gets notified
              const staffSub = new Redis(REDIS_URL, redisOpts);
              staffSub.on('error', () => {});
              staffSub.connect().then(() => {
                staffSub.subscribe(`tracking:${token}`, () => {});
                staffSub.on('message', (_ch, rawMsg) => {
                  try {
                    const parsed = JSON.parse(rawMsg);
                    if (parsed.type === 'session_ended') {
                      socket.send(JSON.stringify({ type: 'session_ended' }));
                      socket.close(4010);
                    }
                  } catch {}
                });
              }).catch(() => {});

              // Clean up staff subscriber on disconnect
              socket.on('close', () => {
                staffSub.unsubscribe().catch(() => {});
                staffSub.quit().catch(() => {});
              });
            } else {
              socket.send(JSON.stringify({ error: 'Authentication failed' }));
              socket.close(4003);
            }
            return;
          }

          if (msg.type !== 'location') return;
          const { lat, lng, accuracy, speed, heading, battery, network } = msg;
          if (typeof lat !== 'number' || typeof lng !== 'number') return;
          if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

          const now = Date.now();
          const f = kf.filter({ lat, lng, accuracy: accuracy || 10, speed: speed || 0, timestamp: now });
          if (f.isOutlier) { socket.send(JSON.stringify({ type: 'outlier_rejected' })); return; }

          buf.push({ ts: now, lat: f.lat, lng: f.lng, rawLat: lat, rawLng: lng,
                      accuracy: accuracy||null, speed: speed||null, heading: heading||null });

          await db.query(
            `UPDATE tracking_sessions
             SET last_lat=$1, last_lng=$2, last_accuracy=$3, last_speed=$4, last_heading=$5,
                 last_update=NOW(),
                 last_battery=COALESCE($6::jsonb, last_battery),
                 last_network=COALESCE($7::jsonb, last_network)
             WHERE token=$8`,
            [f.lat, f.lng, accuracy, speed, heading,
             battery ? JSON.stringify(battery) : null,
             network ? JSON.stringify(network) : null, token]);

          await redisPub.publish(`tracking:${token}`, JSON.stringify({
            type: 'location_update', lat: f.lat, lng: f.lng, accuracy, speed, heading,
            battery: battery||null, network: network||null, timestamp: now,
          }));

          socket.send(JSON.stringify({ type: 'ack', filtered: { lat: f.lat, lng: f.lng } }));
        } catch {}
      });

      socket.on('close', async () => {
        clearTimeout(authTimeout);
        if (flushTimer) clearInterval(flushTimer);
        await flush();
      });
    });
  });

  // ═════════════════════════════════════════════════════
  //  SSE (server → customer)
  // ═════════════════════════════════════════════════════

  app.get('/sse/:token', async (req, reply) => {
    const { token } = req.params;
    if (!isValidToken(token)) return reply.code(400).send({ error: 'Invalid token' });

    const sess = await db.query(`SELECT id, status FROM tracking_sessions WHERE token=$1`, [token]);
    if (sess.rows.length === 0 || sess.rows[0].status !== 'active')
      return reply.code(404).send({ error: 'Session not found or ended' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    reply.raw.write('\n');

    if (!sseClients.has(token)) sseClients.set(token, new Set());
    sseClients.get(token).add(reply.raw);

    const hb = setInterval(() => { try { reply.raw.write(': hb\n\n'); } catch {} }, 25000);
    req.raw.on('close', () => {
      clearInterval(hb);
      const c = sseClients.get(token);
      if (c) { c.delete(reply.raw); if (c.size === 0) sseClients.delete(token); }
    });
  });

  return app;
}

// ═══════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════
async function start() {
  const server = await build();

  // Connect to Redis with retry
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await redisPub.connect();
      await redisSub.connect();
      console.log('[REDIS] Connected');
      break;
    } catch (e) {
      console.warn(`[REDIS] Attempt ${attempt}/5 failed: ${e.message}`);
      if (attempt === 5) throw e;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  // ── Auto-create tables if they don't exist (for cloud deploy) ──
  try {
    await db.query(`SELECT 1 FROM admin_users LIMIT 1`);
    console.log('[DB] Tables already exist');
  } catch {
    console.log('[DB] Creating tables...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tracking_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token VARCHAR(24) UNIQUE NOT NULL,
        session_secret VARCHAR(32) NOT NULL,
        staff_name VARCHAR(255) NOT NULL,
        staff_phone_enc TEXT NOT NULL,
        staff_email_enc TEXT NOT NULL,
        designation VARCHAR(255) DEFAULT '',
        consent_gps BOOLEAN NOT NULL DEFAULT false,
        consent_ip VARCHAR(45),
        consent_ua TEXT,
        consent_at TIMESTAMPTZ,
        ip_geo JSONB DEFAULT '{}',
        device_info JSONB DEFAULT '{}',
        recipient_phone VARCHAR(20),
        recipient_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '4 hours'),
        stopped_at TIMESTAMPTZ,
        last_lat DOUBLE PRECISION,
        last_lng DOUBLE PRECISION,
        last_accuracy REAL,
        last_speed REAL,
        last_heading REAL,
        last_update TIMESTAMPTZ,
        last_battery JSONB DEFAULT '{}',
        last_network JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS location_points (
        id BIGSERIAL PRIMARY KEY,
        session_id UUID NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        raw_lat DOUBLE PRECISION,
        raw_lng DOUBLE PRECISION,
        accuracy REAL,
        speed REAL,
        heading REAL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        actor VARCHAR(255),
        target_id VARCHAR(255),
        ip_address VARCHAR(45),
        details JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lp_session ON location_points(session_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ts_token ON tracking_sessions(token);
      CREATE INDEX IF NOT EXISTS idx_ts_active ON tracking_sessions(status) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_ts_secret ON tracking_sessions(session_secret);
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);
    `);
    console.log('[DB] Tables created successfully');
  }

  // Seed admin user
  const existing = await db.query('SELECT id FROM admin_users WHERE email=$1', [ADMIN_EMAIL]);
  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await db.query('INSERT INTO admin_users (email, password_hash) VALUES ($1,$2)', [ADMIN_EMAIL, hash]);
    console.log(`[ADMIN] Seeded admin: ${ADMIN_EMAIL}`);
  }

  // Redis → SSE bridge
  await redisSub.psubscribe('tracking:*');
  redisSub.on('pmessage', (_p, ch, msg) => {
    const token = ch.split(':')[1];
    const clients = sseClients.get(token);
    if (!clients || clients.size === 0) return;
    const frame = `data: ${msg}\n\n`;
    for (const c of clients) { try { c.write(frame); } catch {} }
  });

  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`\n🏥 Varolyn Tracker (secured) → http://localhost:${PORT}\n`);

  // Expire stale sessions
  setInterval(async () => {
    try { await db.query(`UPDATE tracking_sessions SET status='expired', stopped_at=NOW() WHERE status='active' AND expires_at < NOW()`); } catch {}
  }, 5 * 60_000);

  // Purge old data (>48h)
  setInterval(async () => {
    try {
      await db.query(`DELETE FROM location_points WHERE recorded_at < NOW() - INTERVAL '48 hours'`);
      await db.query(`DELETE FROM tracking_sessions WHERE status != 'active' AND created_at < NOW() - INTERVAL '48 hours'`);
    } catch {}
  }, 60 * 60_000);

  const shutdown = async () => {
    await server.close(); await redisPub.quit(); await redisSub.quit(); await db.end(); process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch(e => { console.error('Fatal:', e); process.exit(1); });
