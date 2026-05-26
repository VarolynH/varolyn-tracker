'use strict';

const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const { Pool } = require('pg');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');

const PORT = parseInt(process.env.AUDIT_PORT || '8087');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const db = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'varolyn_tracker',
  user: process.env.POSTGRES_USER || 'varolyn',
  password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
  max: 10,
});

const redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { lazyConnect: true });

const app = Fastify({ logger: true });

async function build() {
  await app.register(fastifyCors, { origin: true, credentials: true });

  app.get('/health', async () => ({ status: 'ok', service: 'audit' }));

  // ── Auth middleware ─────────────────────────────────────
  function requireAdmin(req, reply) {
    const auth = req.headers.authorization;
    if (!auth) return reply.code(401).send({ error: 'Unauthorized' });
    try {
      const decoded = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
      if (decoded.role !== 'admin') return reply.code(403).send({ error: 'Admin only' });
      return decoded;
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  }

  // ── Log an audit event ─────────────────────────────────
  app.post('/api/audit/log', async (req, reply) => {
    const { actorId, actorRole, action, resourceType, resourceId, details, ipAddress } = req.body || {};
    if (!action || !resourceType) {
      return reply.code(400).send({ error: 'action and resourceType required' });
    }
    const result = await db.query(
      `INSERT INTO audit_log (actor_id, actor_role, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [actorId, actorRole, action, resourceType, resourceId, details ? JSON.stringify(details) : null, ipAddress]
    );
    return { id: result.rows[0].id, created_at: result.rows[0].created_at };
  });

  // ── Query audit log (admin only) ───────────────────────
  app.get('/api/audit/logs', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user || !user.userId) return;

    const { action, resourceType, resourceId, actorId, from, to, page = 1, limit = 50 } = req.query;
    const where = [];
    const params = [];
    let idx = 1;

    if (action) { where.push(`action = $${idx++}`); params.push(action); }
    if (resourceType) { where.push(`resource_type = $${idx++}`); params.push(resourceType); }
    if (resourceId) { where.push(`resource_id = $${idx++}`); params.push(resourceId); }
    if (actorId) { where.push(`actor_id = $${idx++}`); params.push(actorId); }
    if (from) { where.push(`created_at >= $${idx++}`); params.push(from); }
    if (to) { where.push(`created_at <= $${idx++}`); params.push(to); }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await db.query(
      `SELECT * FROM audit_log ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), offset]
    );

    const count = await db.query(`SELECT COUNT(*) FROM audit_log ${whereClause}`, params);

    return {
      logs: result.rows,
      total: parseInt(count.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    };
  });

  // ── Consent chain audit (admin only) ───────────────────
  app.get('/api/audit/consent/:appointmentId', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user || !user.userId) return;

    const result = await db.query(
      `SELECT * FROM consent_chain WHERE appointment_id = $1 ORDER BY id ASC`,
      [req.params.appointmentId]
    );
    return { entries: result.rows };
  });

  // ── Purge log (admin only) ─────────────────────────────
  app.get('/api/audit/purges', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user || !user.userId) return;

    const result = await db.query(
      `SELECT * FROM purge_log ORDER BY executed_at DESC LIMIT 100`
    );
    return { purges: result.rows };
  });

  return app;
}

// ── Redis listener for auto-logging ──────────────────────
async function startAutoLogger() {
  await redisSub.connect();
  const channels = ['appointment:created', 'appointment:updated', 'consent:granted'];
  for (const ch of channels) await redisSub.subscribe(ch);

  redisSub.on('message', async (channel, message) => {
    const data = JSON.parse(message);
    try {
      await db.query(
        `INSERT INTO audit_log (action, resource_type, resource_id, details)
         VALUES ($1, $2, $3, $4)`,
        [channel, 'appointment', data.appointmentId, JSON.stringify(data)]
      );
    } catch (err) {
      console.error('[Audit] Auto-log failed:', err.message);
    }
  });

  console.log('[Audit] Auto-logger listening on Redis channels');
}

async function start() {
  const server = await build();
  await startAutoLogger();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Audit Service] Running on port ${PORT}`);

  const shutdown = async () => {
    await server.close();
    await redisSub.quit();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[Audit] Fatal:', err);
  process.exit(1);
});
