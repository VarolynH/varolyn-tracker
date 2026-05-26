'use strict';

const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const { Pool } = require('pg');
const Redis = require('ioredis');
const crypto = require('crypto');

const PORT = parseInt(process.env.CONSENT_PORT || '8083');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PURGE_TTL_HOURS = parseInt(process.env.CONSENT_DATA_TTL_HOURS || '24');

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

// ── SHA-256 helper ───────────────────────────────────────
function sha256(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function computeConsentHash(prevHash, payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return sha256(`${prevHash}:${canonical}`);
}

const app = Fastify({ logger: true });

async function build() {
  await app.register(fastifyCors, { origin: true, credentials: true });

  app.get('/health', async () => ({ status: 'ok', service: 'consent' }));

  // ────────────────────────────────────────────────────────
  // POST /api/consent/grant
  // Patient grants consent for tracking.
  // Body: { token, consents: { gps_tracking: bool, ip_collection: bool, data_retention: bool } }
  // ────────────────────────────────────────────────────────
  app.post('/api/consent/grant', async (req, reply) => {
    const { token, consents } = req.body || {};
    if (!token || !consents) {
      return reply.code(400).send({ error: 'Missing token or consents' });
    }

    // Validate the tracking link
    const linkResult = await db.query(
      `SELECT tl.*, a.patient_id, a.id as appointment_id
       FROM tracking_links tl
       JOIN appointments a ON a.id = tl.appointment_id
       WHERE tl.token = $1 AND tl.is_active = true AND tl.expires_at > NOW()`,
      [token]
    );

    if (linkResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Invalid or expired tracking link' });
    }

    const link = linkResult.rows[0];

    // GPS tracking consent is mandatory
    if (!consents.gps_tracking) {
      return reply.code(400).send({
        error: 'GPS tracking consent is required to view staff location',
      });
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Begin transaction for atomic consent chain
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Get last hash in chain for this appointment
      const lastEntry = await client.query(
        `SELECT entry_hash FROM consent_chain
         WHERE appointment_id = $1
         ORDER BY id DESC LIMIT 1`,
        [link.appointment_id]
      );
      let prevHash = lastEntry.rows.length > 0 ? lastEntry.rows[0].entry_hash : '0';

      // Insert one chain entry per consent type
      const consentTypes = ['gps_tracking', 'ip_collection', 'data_retention'];
      const chainEntries = [];

      for (const ctype of consentTypes) {
        const granted = consents[ctype] === true;
        const payload = {
          appointment_id: link.appointment_id,
          link_id: link.id,
          patient_id: link.patient_id,
          consent_type: ctype,
          granted,
          ip_address: ip,
          user_agent: userAgent,
          timestamp: new Date().toISOString(),
        };

        const entryHash = computeConsentHash(prevHash, payload);

        await client.query(
          `INSERT INTO consent_chain
            (appointment_id, link_id, patient_id, consent_type, granted,
             ip_address, user_agent, prev_hash, entry_hash, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [link.appointment_id, link.id, link.patient_id, ctype, granted,
           ip, userAgent, prevHash, entryHash, JSON.stringify(payload)]
        );

        chainEntries.push({ type: ctype, granted, hash: entryHash });
        prevHash = entryHash; // Chain continues
      }

      // Update tracking link as consent given
      await client.query(
        `UPDATE tracking_links
         SET consent_given = true, consent_given_at = NOW(),
             patient_ip = $1, patient_ua = $2
         WHERE id = $3`,
        [ip, userAgent, link.id]
      );

      await client.query('COMMIT');

      // Publish consent event to Redis → triggers staff push notification
      await redis.publish('consent:granted', JSON.stringify({
        appointmentId: link.appointment_id,
        patientId: link.patient_id,
        linkId: link.id,
        timestamp: Date.now(),
      }));

      return {
        success: true,
        appointmentId: link.appointment_id,
        chainEntries,
        message: 'Consent recorded immutably. You can now view staff location.',
      };

    } catch (err) {
      await client.query('ROLLBACK');
      req.log.error({ err }, 'Consent grant failed');
      return reply.code(500).send({ error: 'Failed to record consent' });
    } finally {
      client.release();
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/consent/verify/:appointmentId
  // Verify the consent chain integrity (SHA-256 chain validation)
  // ────────────────────────────────────────────────────────
  app.get('/api/consent/verify/:appointmentId', async (req, reply) => {
    const { appointmentId } = req.params;

    const entries = await db.query(
      `SELECT * FROM consent_chain
       WHERE appointment_id = $1
       ORDER BY id ASC`,
      [appointmentId]
    );

    if (entries.rows.length === 0) {
      return reply.code(404).send({ error: 'No consent records found' });
    }

    let valid = true;
    let brokenAt = null;

    for (let i = 0; i < entries.rows.length; i++) {
      const entry = entries.rows[i];
      const expectedPrev = i === 0 ? '0' : entries.rows[i - 1].entry_hash;

      if (entry.prev_hash !== expectedPrev) {
        valid = false;
        brokenAt = i;
        break;
      }

      // Verify entry hash
      const recomputed = computeConsentHash(entry.prev_hash, entry.payload_json);
      if (recomputed !== entry.entry_hash) {
        valid = false;
        brokenAt = i;
        break;
      }
    }

    return {
      appointmentId,
      totalEntries: entries.rows.length,
      chainValid: valid,
      brokenAtEntry: brokenAt,
      latestHash: entries.rows[entries.rows.length - 1].entry_hash,
    };
  });

  // ────────────────────────────────────────────────────────
  // GET /api/consent/status/:token
  // Check if consent has been given for a tracking link
  // ────────────────────────────────────────────────────────
  app.get('/api/consent/status/:token', async (req, reply) => {
    const { token } = req.params;
    const link = await db.query(
      `SELECT id, appointment_id, consent_given, consent_given_at, expires_at, is_active
       FROM tracking_links
       WHERE token = $1`,
      [token]
    );
    if (link.rows.length === 0) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    const row = link.rows[0];
    return {
      hasConsent: row.consent_given,
      consentAt: row.consent_given_at,
      isActive: row.is_active,
      isExpired: new Date(row.expires_at) < new Date(),
    };
  });

  // ────────────────────────────────────────────────────────
  // POST /api/consent/revoke
  // Right to erasure (GDPR Art. 17 / DPDP 2023 Sec. 12)
  // ────────────────────────────────────────────────────────
  app.post('/api/consent/revoke', async (req, reply) => {
    const { token } = req.body || {};
    if (!token) {
      return reply.code(400).send({ error: 'Missing token' });
    }

    const link = await db.query(
      `SELECT tl.*, a.patient_id, a.id as appointment_id
       FROM tracking_links tl
       JOIN appointments a ON a.id = tl.appointment_id
       WHERE tl.token = $1`,
      [token]
    );

    if (link.rows.length === 0) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    const appointmentId = link.rows[0].appointment_id;

    // Deactivate tracking link
    await db.query(
      'UPDATE tracking_links SET is_active = false WHERE token = $1',
      [token]
    );

    // Delete location history for this appointment
    const deleted = await db.query(
      'DELETE FROM location_history WHERE appointment_id = $1',
      [appointmentId]
    );

    // Delete ETA snapshots
    await db.query(
      'DELETE FROM eta_snapshots WHERE appointment_id = $1',
      [appointmentId]
    );

    // Log the purge (consent chain itself is NOT deleted — it's the proof of consent)
    await db.query(
      `INSERT INTO purge_log (purge_type, records_deleted, table_name, appointment_id)
       VALUES ('right_to_erasure', $1, 'location_history', $2)`,
      [deleted.rowCount, appointmentId]
    );

    // Notify tracking service to stop
    await redis.publish(`tracking:${appointmentId}`, JSON.stringify({
      type: 'tracking_revoked',
      appointmentId,
      timestamp: Date.now(),
    }));

    return {
      success: true,
      recordsDeleted: deleted.rowCount,
      message: 'Consent revoked. All location data has been permanently deleted.',
    };
  });

  // ────────────────────────────────────────────────────────
  // Cron: Auto-purge expired data (runs every hour)
  // ────────────────────────────────────────────────────────
  async function purgeExpiredData() {
    try {
      const cutoff = new Date(Date.now() - PURGE_TTL_HOURS * 60 * 60 * 1000).toISOString();

      // Purge location history older than TTL
      const locResult = await db.query(
        `DELETE FROM location_history WHERE time < $1`,
        [cutoff]
      );

      // Purge ETA snapshots
      const etaResult = await db.query(
        `DELETE FROM eta_snapshots WHERE estimated_at < $1`,
        [cutoff]
      );

      // Deactivate expired tracking links
      await db.query(
        `UPDATE tracking_links SET is_active = false WHERE expires_at < NOW() AND is_active = true`
      );

      if (locResult.rowCount > 0 || etaResult.rowCount > 0) {
        await db.query(
          `INSERT INTO purge_log (purge_type, records_deleted, table_name)
           VALUES ('auto_ttl', $1, 'location_history+eta_snapshots')`,
          [locResult.rowCount + etaResult.rowCount]
        );
        console.log(`[Consent] Auto-purge: deleted ${locResult.rowCount} locations, ${etaResult.rowCount} ETAs`);
      }
    } catch (err) {
      console.error('[Consent] Purge error:', err.message);
    }
  }

  // Run purge every hour
  setInterval(purgeExpiredData, 60 * 60 * 1000);

  return app;
}

async function start() {
  const server = await build();
  await redis.connect();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Consent Service] Running on port ${PORT}`);

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
  console.error('[Consent] Fatal:', err);
  process.exit(1);
});
