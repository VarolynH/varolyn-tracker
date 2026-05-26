'use strict';

const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const { Pool } = require('pg');

const PORT = parseInt(process.env.LINK_PORT || '8084');

const db = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'varolyn_tracker',
  user: process.env.POSTGRES_USER || 'varolyn',
  password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
  max: 10,
});

const app = Fastify({ logger: true });

async function build() {
  await app.register(fastifyCors, { origin: true, credentials: true });

  app.get('/health', async () => ({ status: 'ok', service: 'link' }));

  // ── Resolve tracking link → appointment data ──────────
  app.get('/api/link/resolve/:token', async (req, reply) => {
    const { token } = req.params;

    const result = await db.query(
      `SELECT tl.*,
              a.status as appointment_status,
              a.service_type,
              a.scheduled_at,
              a.destination_lat,
              a.destination_lng,
              a.destination_address,
              p.full_name as patient_name,
              u.full_name as staff_name,
              sp.specialization,
              sp.vehicle_type,
              sp.photo_url as staff_photo
       FROM tracking_links tl
       JOIN appointments a ON a.id = tl.appointment_id
       JOIN patients p ON p.id = a.patient_id
       JOIN staff_profiles sp ON sp.id = a.staff_id
       JOIN users u ON u.id = sp.user_id
       WHERE tl.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Tracking link not found' });
    }

    const link = result.rows[0];

    // Check expiry
    if (new Date(link.expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Tracking link has expired' });
    }

    if (!link.is_active) {
      return reply.code(410).send({ error: 'Tracking link is no longer active' });
    }

    return {
      token: link.token,
      appointmentId: link.appointment_id,
      hasConsent: link.consent_given,
      appointmentStatus: link.appointment_status,
      serviceType: link.service_type,
      scheduledAt: link.scheduled_at,
      destinationAddress: link.destination_address,
      staffName: link.staff_name,
      staffSpecialization: link.specialization,
      staffVehicleType: link.vehicle_type,
      staffPhoto: link.staff_photo,
      patientName: link.patient_name,
      expiresAt: link.expires_at,
    };
  });

  return app;
}

async function start() {
  const server = await build();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Link Service] Running on port ${PORT}`);

  const shutdown = async () => { await server.close(); await db.end(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[Link] Fatal:', err);
  process.exit(1);
});
