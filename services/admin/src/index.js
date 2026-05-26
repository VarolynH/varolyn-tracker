'use strict';

const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = parseInt(process.env.ADMIN_PORT || '8088');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const db = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'varolyn_tracker',
  user: process.env.POSTGRES_USER || 'varolyn',
  password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
  max: 10,
});

function requireAdmin(req, reply) {
  const auth = req.headers.authorization;
  if (!auth) { reply.code(401).send({ error: 'Unauthorized' }); return null; }
  try {
    const decoded = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    if (decoded.role !== 'admin') { reply.code(403).send({ error: 'Admin only' }); return null; }
    return decoded;
  } catch {
    reply.code(401).send({ error: 'Invalid token' }); return null;
  }
}

const app = Fastify({ logger: true });

async function build() {
  await app.register(fastifyCors, { origin: true, credentials: true });

  app.get('/health', async () => ({ status: 'ok', service: 'admin' }));

  // ── Staff management ───────────────────────────────────
  app.post('/api/admin/staff', async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const { email, password, fullName, phone, specialization, vehicleType } = req.body || {};
    if (!email || !password || !fullName) {
      return reply.code(400).send({ error: 'email, password, fullName required' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, role, full_name, phone)
         VALUES ($1, $2, 'staff', $3, $4) RETURNING id`,
        [email, passwordHash, fullName, phone || null]
      );

      const staffResult = await client.query(
        `INSERT INTO staff_profiles (user_id, specialization, vehicle_type)
         VALUES ($1, $2, $3) RETURNING id`,
        [userResult.rows[0].id, specialization || null, vehicleType || 'car']
      );

      await client.query('COMMIT');

      return {
        userId: userResult.rows[0].id,
        staffId: staffResult.rows[0].id,
        email,
        fullName,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Email already exists' });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/api/admin/staff', async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const result = await db.query(
      `SELECT u.id as user_id, sp.id as staff_id, u.email, u.full_name,
              u.phone, sp.specialization, sp.vehicle_type, sp.is_available,
              u.is_active, u.created_at
       FROM users u
       JOIN staff_profiles sp ON sp.user_id = u.id
       WHERE u.role = 'staff'
       ORDER BY u.created_at DESC`
    );
    return { staff: result.rows };
  });

  // ── Patient management ─────────────────────────────────
  app.post('/api/admin/patients', async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const { fullName, phone, email, addressLine, addressLat, addressLng } = req.body || {};
    if (!fullName) return reply.code(400).send({ error: 'fullName required' });

    const result = await db.query(
      `INSERT INTO patients (full_name, phone, email, address_line, address_lat, address_lng)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [fullName, phone || null, email || null, addressLine || null, addressLat || null, addressLng || null]
    );
    return result.rows[0];
  });

  app.get('/api/admin/patients', async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const { search, page = 1, limit = 20 } = req.query;
    let whereClause = '';
    const params = [];
    let idx = 1;

    if (search) {
      whereClause = `WHERE full_name ILIKE $${idx++} OR phone ILIKE $${idx++} OR email ILIKE $${idx++}`;
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const result = await db.query(
      `SELECT * FROM patients ${whereClause}
       ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), offset]
    );

    const count = await db.query(`SELECT COUNT(*) FROM patients ${whereClause}`, params);
    return { patients: result.rows, total: parseInt(count.rows[0].count) };
  });

  // ── Dashboard stats ────────────────────────────────────
  app.get('/api/admin/stats', async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const [appointments, activeTracking, staff, patients] = await Promise.all([
      db.query(`SELECT status, COUNT(*) as count FROM appointments GROUP BY status`),
      db.query(`SELECT COUNT(*) FROM appointments WHERE status IN ('staff_en_route', 'arrived', 'in_progress')`),
      db.query(`SELECT COUNT(*) FROM staff_profiles WHERE is_available = true`),
      db.query(`SELECT COUNT(*) FROM patients`),
    ]);

    return {
      appointmentsByStatus: appointments.rows.reduce((acc, r) => { acc[r.status] = parseInt(r.count); return acc; }, {}),
      activeTrackingSessions: parseInt(activeTracking.rows[0].count),
      availableStaff: parseInt(staff.rows[0].count),
      totalPatients: parseInt(patients.rows[0].count),
    };
  });

  return app;
}

async function start() {
  const server = await build();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Admin Service] Running on port ${PORT}`);

  const shutdown = async () => {
    await server.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[Admin] Fatal:', err);
  process.exit(1);
});
