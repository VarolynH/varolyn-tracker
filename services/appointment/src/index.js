'use strict';

const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const { Pool } = require('pg');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const PORT = parseInt(process.env.APPOINTMENT_PORT || '8081');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const LINK_EXPIRY_HOURS = parseInt(process.env.TRACKING_LINK_EXPIRY_HOURS || '4');

const db = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'varolyn_tracker',
  user: process.env.POSTGRES_USER || 'varolyn',
  password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
  max: 10,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

function generateToken(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let token = '';
  for (let i = 0; i < length; i++) token += chars[bytes[i] % chars.length];
  return token;
}

function verifyJWT(request) {
  const auth = request.headers.authorization;
  if (!auth) throw new Error('Missing authorization header');
  return jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
}

const app = Fastify({ logger: true });

async function build() {
  await app.register(fastifyCors, { origin: true, credentials: true });

  app.get('/health', async () => ({ status: 'ok', service: 'appointment' }));

  // ── Auth middleware decorator ───────────────────────────
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/health') return;
    try {
      req.user = verifyJWT(req);
    } catch {
      // Some endpoints don't require auth
    }
  });

  // ────────────────────────────────────────────────────────
  // POST /api/appointments — Create appointment + tracking link
  // ────────────────────────────────────────────────────────
  app.post('/api/appointments', async (req, reply) => {
    if (!req.user || !['admin', 'staff'].includes(req.user.role)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const {
      patientId, staffId, scheduledAt, estimatedDurationMin = 60,
      serviceType, destinationLat, destinationLng, destinationAddress, notes,
    } = req.body || {};

    if (!patientId || !staffId || !scheduledAt || !serviceType || !destinationLat || !destinationLng) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Create the appointment
      const apptResult = await client.query(
        `INSERT INTO appointments
          (patient_id, staff_id, scheduled_at, estimated_duration_min,
           service_type, destination_lat, destination_lng, destination_address, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [patientId, staffId, scheduledAt, estimatedDurationMin,
         serviceType, destinationLat, destinationLng, destinationAddress || '', notes || '']
      );
      const appointment = apptResult.rows[0];

      // Generate unique tracking link
      let token;
      let attempts = 0;
      while (attempts < 10) {
        token = generateToken(8);
        const existing = await client.query(
          'SELECT id FROM tracking_links WHERE token = $1',
          [token]
        );
        if (existing.rows.length === 0) break;
        attempts++;
      }

      const expiresAt = new Date(
        new Date(scheduledAt).getTime() + LINK_EXPIRY_HOURS * 60 * 60 * 1000
      ).toISOString();

      const linkResult = await client.query(
        `INSERT INTO tracking_links (appointment_id, token, expires_at)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [appointment.id, token, expiresAt]
      );

      await client.query('COMMIT');

      const trackingUrl = `${BASE_URL}/track/${token}`;

      // Publish event for notification service
      await redis.publish('appointment:created', JSON.stringify({
        appointmentId: appointment.id,
        patientId,
        staffId,
        trackingUrl,
        token,
        scheduledAt,
        serviceType,
      }));

      return {
        appointment,
        trackingLink: linkResult.rows[0],
        trackingUrl,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      req.log.error({ err }, 'Failed to create appointment');
      return reply.code(500).send({ error: 'Failed to create appointment' });
    } finally {
      client.release();
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/appointments/:id
  // ────────────────────────────────────────────────────────
  app.get('/api/appointments/:id', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Unauthorized' });

    const result = await db.query(
      `SELECT a.*,
              tl.token as tracking_token,
              tl.is_active as link_active,
              tl.consent_given,
              p.full_name as patient_name,
              p.phone as patient_phone,
              u.full_name as staff_name,
              sp.specialization,
              sp.vehicle_type
       FROM appointments a
       LEFT JOIN tracking_links tl ON tl.appointment_id = a.id
       LEFT JOIN patients p ON p.id = a.patient_id
       LEFT JOIN staff_profiles sp ON sp.id = a.staff_id
       LEFT JOIN users u ON u.id = sp.user_id
       WHERE a.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Appointment not found' });
    }
    return result.rows[0];
  });

  // ────────────────────────────────────────────────────────
  // GET /api/appointments — List appointments (with filters)
  // ────────────────────────────────────────────────────────
  app.get('/api/appointments', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Unauthorized' });

    const { status, staffId, date, page = 1, limit = 20 } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (status) { where.push(`a.status = $${idx++}`); params.push(status); }
    if (staffId) { where.push(`a.staff_id = $${idx++}`); params.push(staffId); }
    if (date) {
      where.push(`DATE(a.scheduled_at) = $${idx++}`);
      params.push(date);
    }

    // Staff can only see their own appointments
    if (req.user.role === 'staff') {
      where.push(`a.staff_id = $${idx++}`);
      params.push(req.user.staffId);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await db.query(
      `SELECT a.*,
              tl.token as tracking_token,
              tl.consent_given,
              p.full_name as patient_name,
              u.full_name as staff_name
       FROM appointments a
       LEFT JOIN tracking_links tl ON tl.appointment_id = a.id
       LEFT JOIN patients p ON p.id = a.patient_id
       LEFT JOIN staff_profiles sp ON sp.id = a.staff_id
       LEFT JOIN users u ON u.id = sp.user_id
       ${whereClause}
       ORDER BY a.scheduled_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM appointments a ${whereClause}`,
      params
    );

    return {
      appointments: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    };
  });

  // ────────────────────────────────────────────────────────
  // PATCH /api/appointments/:id — Update appointment
  // ────────────────────────────────────────────────────────
  app.patch('/api/appointments/:id', async (req, reply) => {
    if (!req.user || !['admin', 'staff'].includes(req.user.role)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const allowedFields = ['status', 'scheduled_at', 'notes', 'service_type'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(req.body || {})) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(snakeKey)) {
        updates.push(`${snakeKey} = $${idx++}`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'No valid fields to update' });
    }

    values.push(req.params.id);
    const result = await db.query(
      `UPDATE appointments SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Appointment not found' });
    }

    // Publish status change if status was updated
    if (req.body.status) {
      await redis.publish('appointment:updated', JSON.stringify({
        appointmentId: req.params.id,
        status: req.body.status,
        timestamp: Date.now(),
      }));
    }

    return result.rows[0];
  });

  // ────────────────────────────────────────────────────────
  // GET /api/appointments/staff/active — Staff's active appointment
  // ────────────────────────────────────────────────────────
  app.get('/api/appointments/staff/active', async (req, reply) => {
    if (!req.user || req.user.role !== 'staff') {
      return reply.code(401).send({ error: 'Staff auth required' });
    }

    const result = await db.query(
      `SELECT a.*, tl.token as tracking_token, tl.consent_given,
              p.full_name as patient_name, p.address_line as patient_address,
              p.address_lat as patient_lat, p.address_lng as patient_lng
       FROM appointments a
       LEFT JOIN tracking_links tl ON tl.appointment_id = a.id
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.staff_id = $1 AND a.status IN ('scheduled', 'staff_en_route', 'arrived', 'in_progress')
       ORDER BY a.scheduled_at ASC LIMIT 5`,
      [req.user.staffId]
    );
    return { appointments: result.rows };
  });

  return app;
}

async function start() {
  const server = await build();
  await redis.connect();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Appointment Service] Running on port ${PORT}`);

  const shutdown = async () => {
    await server.close();
    await redis.quit();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[Appointment] Fatal:', err);
  process.exit(1);
});
