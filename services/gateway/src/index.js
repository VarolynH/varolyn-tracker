'use strict';

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const proxy = require('@fastify/http-proxy');
const jwt = require('jsonwebtoken');

const PORT = parseInt(process.env.GATEWAY_PORT || '8080');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const app = Fastify({
  logger: true,
  trustProxy: true,
});

async function build() {
  // ── Security headers ───────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'blob:'],
        connectSrc: ["'self'", 'wss:', 'ws:'],
        workerSrc: ["'self'", 'blob:'],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // ── CORS ───────────────────────────────────────────────
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });

  // ── Rate limiting ──────────────────────────────────────
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
    keyGenerator: (req) => req.ip,
  });

  // ── Health ─────────────────────────────────────────────
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'gateway',
    timestamp: new Date().toISOString(),
  }));

  // ── Auth endpoints (login, register) ───────────────────
  app.post('/api/auth/login', async (req, reply) => {
    // Proxy to admin service for auth, or handle here
    const { Pool } = require('pg');
    const bcrypt = require('jsonwebtoken'); // We'll verify differently
    const pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'varolyn_tracker',
      user: process.env.POSTGRES_USER || 'varolyn',
      password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
    });

    const { email, password } = req.body || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password required' });
    }

    const result = await pool.query(
      `SELECT u.*, sp.id as staff_profile_id
       FROM users u
       LEFT JOIN staff_profiles sp ON sp.user_id = u.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );

    if (result.rows.length === 0) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password using bcryptjs
    const bcryptjs = require('bcryptjs');
    let valid = false;
    try {
      valid = await bcryptjs.compare(password, user.password_hash);
    } catch {
      // If bcryptjs not available in gateway, we should proxy to admin
      valid = false;
    }

    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
    };

    if (user.role === 'staff' && user.staff_profile_id) {
      tokenPayload.staffId = user.staff_profile_id;
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    await pool.end();

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
        staffId: user.staff_profile_id,
      },
    };
  });

  // ── Service proxies ────────────────────────────────────
  const serviceRoutes = [
    { prefix: '/api/appointments', upstream: `http://appointment:${process.env.APPOINTMENT_PORT || 8081}` },
    { prefix: '/api/tracking', upstream: `http://tracking:${process.env.TRACKING_PORT || 8082}` },
    { prefix: '/api/consent', upstream: `http://consent:${process.env.CONSENT_PORT || 8083}` },
    { prefix: '/api/notifications', upstream: `http://notification:${process.env.NOTIFICATION_PORT || 8085}` },
    { prefix: '/api/audit', upstream: `http://audit:${process.env.AUDIT_PORT || 8087}` },
    { prefix: '/api/admin', upstream: `http://admin:${process.env.ADMIN_PORT || 8088}` },
  ];

  for (const route of serviceRoutes) {
    await app.register(proxy, {
      upstream: route.upstream,
      prefix: route.prefix,
      rewritePrefix: route.prefix,
      http2: false,
    });
  }

  // ── WebSocket proxy for tracking ───────────────────────
  await app.register(proxy, {
    upstream: `http://tracking:${process.env.TRACKING_PORT || 8082}`,
    prefix: '/ws',
    rewritePrefix: '/ws',
    websocket: true,
  });

  // ── SSE proxy ──────────────────────────────────────────
  await app.register(proxy, {
    upstream: `http://tracking:${process.env.TRACKING_PORT || 8082}`,
    prefix: '/sse',
    rewritePrefix: '/sse',
  });

  return app;
}

async function start() {
  const server = await build();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Gateway] Running on port ${PORT}`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[Gateway] Fatal:', err);
  process.exit(1);
});
