'use strict';

const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const fastifyWebsocket = require('@fastify/websocket');
const { Pool } = require('pg');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const { GPSKalmanFilter, haversineDistance } = require('./kalman');

// ── Config ───────────────────────────────────────────────
const PORT = parseInt(process.env.TRACKING_PORT || '8082');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';
const MAX_STALE_SEC = parseInt(process.env.TRACKING_MAX_STALE_SECONDS || '120');

// ── Database ─────────────────────────────────────────────
const db = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'varolyn_tracker',
  user: process.env.POSTGRES_USER || 'varolyn',
  password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
  max: 20,
});

// ── Redis (two connections: pub + sub) ───────────────────
const redisPub = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
const redisSub = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });

// ── Per-staff Kalman filters (in-memory, keyed by appointment) ──
const kalmanFilters = new Map();

// ── Active SSE connections (keyed by appointment_id) ─────
const sseClients = new Map(); // Map<appointmentId, Set<reply>>

// ── Fastify app ──────────────────────────────────────────
const app = Fastify({ logger: true });

async function build() {
  await app.register(fastifyCors, { origin: true, credentials: true });
  await app.register(fastifyWebsocket);

  // Health check
  app.get('/health', async () => ({ status: 'ok', service: 'tracking' }));

  // ────────────────────────────────────────────────────────
  // WebSocket: Staff location ingestion
  // Path: /ws/track/:appointmentId
  // Auth: JWT in query string (?token=xxx) or first message
  // ────────────────────────────────────────────────────────
  app.register(async function (fastify) {
    fastify.get('/ws/track/:appointmentId', { websocket: true }, async (socket, req) => {
      const { appointmentId } = req.params;
      let staffId = null;
      let authenticated = false;

      // Try token from query string first
      const queryToken = req.query.token;
      if (queryToken) {
        try {
          const decoded = jwt.verify(queryToken, JWT_SECRET);
          if (decoded.role !== 'staff') {
            socket.send(JSON.stringify({ error: 'Forbidden: staff role required' }));
            socket.close(4003);
            return;
          }
          staffId = decoded.staffId;
          authenticated = true;

          // Verify appointment belongs to this staff
          const appt = await db.query(
            'SELECT id FROM appointments WHERE id = $1 AND staff_id = $2 AND status IN ($3, $4)',
            [appointmentId, staffId, 'staff_en_route', 'scheduled']
          );
          if (appt.rows.length === 0) {
            socket.send(JSON.stringify({ error: 'Appointment not found or not assigned to you' }));
            socket.close(4004);
            return;
          }

          // Update appointment status to en_route
          await db.query(
            'UPDATE appointments SET status = $1 WHERE id = $2 AND status = $3',
            ['staff_en_route', appointmentId, 'scheduled']
          );

          socket.send(JSON.stringify({ type: 'authenticated', appointmentId }));
        } catch (err) {
          socket.send(JSON.stringify({ error: 'Invalid token' }));
          socket.close(4001);
          return;
        }
      }

      // Initialize Kalman filter for this session
      if (!kalmanFilters.has(appointmentId)) {
        kalmanFilters.set(appointmentId, new GPSKalmanFilter());
      }
      const kf = kalmanFilters.get(appointmentId);

      let lastEtaCheck = 0;
      let lastEtaValue = null;

      // Batch insert buffer (flush every 5 points or 10s)
      const insertBuffer = [];
      let flushTimer = null;

      async function flushInserts() {
        if (insertBuffer.length === 0) return;
        const batch = insertBuffer.splice(0);
        const values = [];
        const placeholders = [];
        let idx = 1;
        for (const loc of batch) {
          placeholders.push(
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
          );
          values.push(
            loc.time, appointmentId, staffId,
            loc.lat, loc.lng, loc.accuracy, loc.altitude,
            loc.speed, loc.heading, loc.batteryLevel,
            loc.isForeground, loc.rawLat, loc.rawLng, loc.source
          );
        }
        try {
          await db.query(
            `INSERT INTO location_history
              (time, appointment_id, staff_id, lat, lng, accuracy, altitude, speed, heading, battery_level, is_foreground, raw_lat, raw_lng, source)
             VALUES ${placeholders.join(', ')}`,
            values
          );
        } catch (err) {
          req.log.error({ err }, 'Failed to flush location batch');
        }
      }

      // Schedule periodic flush
      flushTimer = setInterval(flushInserts, 10000);

      socket.on('message', async (rawData) => {
        try {
          const msg = JSON.parse(rawData.toString());

          // Handle auth message if not yet authenticated
          if (!authenticated && msg.type === 'auth') {
            try {
              const decoded = jwt.verify(msg.token, JWT_SECRET);
              if (decoded.role !== 'staff') {
                socket.send(JSON.stringify({ error: 'Forbidden' }));
                socket.close(4003);
                return;
              }
              staffId = decoded.staffId;
              authenticated = true;
              socket.send(JSON.stringify({ type: 'authenticated', appointmentId }));
            } catch {
              socket.send(JSON.stringify({ error: 'Invalid token' }));
              socket.close(4001);
            }
            return;
          }

          if (!authenticated) {
            socket.send(JSON.stringify({ error: 'Not authenticated' }));
            return;
          }

          // ── Location update message ───────────────────
          if (msg.type === 'location') {
            const now = Date.now();
            const rawLat = msg.lat;
            const rawLng = msg.lng;

            // Validate coordinates
            if (typeof rawLat !== 'number' || typeof rawLng !== 'number' ||
                rawLat < -90 || rawLat > 90 || rawLng < -180 || rawLng > 180) {
              socket.send(JSON.stringify({ error: 'Invalid coordinates' }));
              return;
            }

            // Apply Kalman filter
            const filtered = kf.filter({
              lat: rawLat,
              lng: rawLng,
              accuracy: msg.accuracy || 10,
              speed: msg.speed || 0,
              timestamp: now,
            });

            if (filtered.isOutlier) {
              socket.send(JSON.stringify({ type: 'outlier_rejected' }));
              return;
            }

            const locationEvent = {
              type: 'location_update',
              appointmentId,
              staffId,
              lat: filtered.lat,
              lng: filtered.lng,
              speed: filtered.speed,
              heading: msg.heading || 0,
              accuracy: msg.accuracy || 10,
              batteryLevel: msg.batteryLevel,
              isForeground: msg.isForeground !== false,
              timestamp: now,
            };

            // Store in buffer for batch insert
            insertBuffer.push({
              time: new Date(now).toISOString(),
              lat: filtered.lat,
              lng: filtered.lng,
              accuracy: msg.accuracy || 10,
              altitude: msg.altitude || null,
              speed: filtered.speed,
              heading: msg.heading || 0,
              batteryLevel: msg.batteryLevel || null,
              isForeground: msg.isForeground !== false,
              rawLat,
              rawLng,
              source: 'gps',
            });

            // Flush if buffer gets large
            if (insertBuffer.length >= 5) {
              flushInserts();
            }

            // Publish to Redis for SSE broadcast
            await redisPub.publish(
              `tracking:${appointmentId}`,
              JSON.stringify(locationEvent)
            );

            // Cache latest position in Redis (for new SSE connections)
            await redisPub.set(
              `latest:${appointmentId}`,
              JSON.stringify(locationEvent),
              'EX',
              MAX_STALE_SEC
            );

            // ── ETA calculation (throttled: every 30s or >50m deviation) ──
            const shouldCalcEta = (now - lastEtaCheck > 30000);
            if (shouldCalcEta) {
              lastEtaCheck = now;
              try {
                const eta = await computeETA(appointmentId, filtered.lat, filtered.lng);
                if (eta && (!lastEtaValue || Math.abs(eta.duration - lastEtaValue) > 60)) {
                  lastEtaValue = eta.duration;
                  const etaEvent = {
                    type: 'eta_update',
                    appointmentId,
                    etaSeconds: eta.duration,
                    distanceMeters: eta.distance,
                    timestamp: now,
                  };
                  await redisPub.publish(`tracking:${appointmentId}`, JSON.stringify(etaEvent));

                  // Store ETA snapshot
                  const apptRow = await db.query(
                    'SELECT destination_lat, destination_lng FROM appointments WHERE id = $1',
                    [appointmentId]
                  );
                  if (apptRow.rows[0]) {
                    await db.query(
                      `INSERT INTO eta_snapshots (appointment_id, eta_seconds, distance_meters, staff_lat, staff_lng, dest_lat, dest_lng)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                      [appointmentId, eta.duration, eta.distance,
                       filtered.lat, filtered.lng,
                       apptRow.rows[0].destination_lat, apptRow.rows[0].destination_lng]
                    );
                  }
                }
              } catch (err) {
                req.log.warn({ err }, 'ETA computation failed (OSRM may be offline)');
              }
            }

            // ACK
            socket.send(JSON.stringify({ type: 'ack', ts: now }));
          }

          // ── Status update ─────────────────────────────
          if (msg.type === 'status') {
            const validStatuses = ['arrived', 'in_progress', 'completed'];
            if (!validStatuses.includes(msg.status)) {
              socket.send(JSON.stringify({ error: 'Invalid status' }));
              return;
            }
            await db.query(
              'UPDATE appointments SET status = $1 WHERE id = $2',
              [msg.status, appointmentId]
            );
            const statusEvent = {
              type: 'status_update',
              appointmentId,
              status: msg.status,
              timestamp: Date.now(),
            };
            await redisPub.publish(`tracking:${appointmentId}`, JSON.stringify(statusEvent));

            if (msg.status === 'completed') {
              // Clean up
              kalmanFilters.delete(appointmentId);
              await redisPub.del(`latest:${appointmentId}`);
              socket.send(JSON.stringify({ type: 'tracking_complete' }));
              socket.close(1000, 'Tracking completed');
            }
          }

          // ── Visibility change (background/foreground) ──
          if (msg.type === 'visibility') {
            const visEvent = {
              type: 'visibility_change',
              appointmentId,
              visible: msg.visible,
              timestamp: Date.now(),
            };
            await redisPub.publish(`tracking:${appointmentId}`, JSON.stringify(visEvent));
          }

        } catch (err) {
          req.log.error({ err }, 'WebSocket message processing error');
          socket.send(JSON.stringify({ error: 'Processing error' }));
        }
      });

      socket.on('close', () => {
        clearInterval(flushTimer);
        flushInserts(); // Flush remaining
        req.log.info(`Staff WebSocket closed for appointment ${appointmentId}`);
      });

      socket.on('error', (err) => {
        req.log.error({ err }, 'WebSocket error');
        clearInterval(flushTimer);
      });
    });
  });

  // ────────────────────────────────────────────────────────
  // SSE: Patient real-time tracking stream
  // Path: /sse/track/:token
  // No auth required (token = tracking link token, validated)
  // ────────────────────────────────────────────────────────
  app.get('/sse/track/:token', async (req, reply) => {
    const { token } = req.params;

    // Validate tracking link
    const link = await db.query(
      `SELECT tl.*, a.status as appt_status, a.destination_lat, a.destination_lng
       FROM tracking_links tl
       JOIN appointments a ON a.id = tl.appointment_id
       WHERE tl.token = $1 AND tl.is_active = true AND tl.consent_given = true
         AND tl.expires_at > NOW()`,
      [token]
    );

    if (link.rows.length === 0) {
      reply.code(404).send({ error: 'Tracking link not found, expired, or consent not given' });
      return;
    }

    const { appointment_id: appointmentId, appt_status } = link.rows[0];

    // If appointment already completed/cancelled, return final status
    if (['completed', 'cancelled', 'no_show'].includes(appt_status)) {
      reply.code(410).send({ error: 'Tracking session has ended', status: appt_status });
      return;
    }

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',     // Disable nginx buffering
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial state
    const latestRaw = await redisPub.get(`latest:${appointmentId}`);
    if (latestRaw) {
      reply.raw.write(`event: location_update\ndata: ${latestRaw}\n\n`);
    }

    // Send appointment info
    const apptInfo = await db.query(
      `SELECT a.status, a.service_type, a.scheduled_at,
              sp.specialization, u.full_name as staff_name, sp.photo_url, sp.vehicle_type
       FROM appointments a
       JOIN staff_profiles sp ON sp.id = a.staff_id
       JOIN users u ON u.id = sp.user_id
       WHERE a.id = $1`,
      [appointmentId]
    );
    if (apptInfo.rows[0]) {
      reply.raw.write(`event: appointment_info\ndata: ${JSON.stringify(apptInfo.rows[0])}\n\n`);
    }

    // Register this SSE client
    if (!sseClients.has(appointmentId)) {
      sseClients.set(appointmentId, new Set());
    }
    sseClients.get(appointmentId).add(reply.raw);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(`:heartbeat\n\n`);
    }, 30000);

    // Clean up on disconnect
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      const clients = sseClients.get(appointmentId);
      if (clients) {
        clients.delete(reply.raw);
        if (clients.size === 0) sseClients.delete(appointmentId);
      }
    });
  });

  // ────────────────────────────────────────────────────────
  // REST: Get last known location
  // ────────────────────────────────────────────────────────
  app.get('/api/tracking/:appointmentId/latest', async (req, reply) => {
    const { appointmentId } = req.params;
    const cached = await redisPub.get(`latest:${appointmentId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fallback to DB
    const row = await db.query(
      `SELECT * FROM location_history
       WHERE appointment_id = $1
       ORDER BY time DESC LIMIT 1`,
      [appointmentId]
    );
    if (row.rows[0]) {
      return row.rows[0];
    }
    reply.code(404).send({ error: 'No location data' });
  });

  // ────────────────────────────────────────────────────────
  // REST: Get location history for an appointment
  // ────────────────────────────────────────────────────────
  app.get('/api/tracking/:appointmentId/history', async (req, reply) => {
    // JWT auth required (admin or the staff themselves)
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    try {
      const decoded = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET);
      const { appointmentId } = req.params;

      const result = await db.query(
        `SELECT time, lat, lng, accuracy, speed, heading, battery_level, is_foreground, source
         FROM location_history
         WHERE appointment_id = $1
         ORDER BY time ASC`,
        [appointmentId]
      );
      return { points: result.rows };
    } catch {
      reply.code(401).send({ error: 'Invalid token' });
    }
  });

  return app;
}

// ── ETA via OSRM (free, self-hosted) ─────────────────────
async function computeETA(appointmentId, staffLat, staffLng) {
  const appt = await db.query(
    'SELECT destination_lat, destination_lng FROM appointments WHERE id = $1',
    [appointmentId]
  );
  if (!appt.rows[0]) return null;

  const { destination_lat: destLat, destination_lng: destLng } = appt.rows[0];

  try {
    const url = `${OSRM_URL}/route/v1/driving/${staffLng},${staffLat};${destLng},${destLat}?overview=false`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      return {
        duration: Math.round(data.routes[0].duration), // seconds
        distance: Math.round(data.routes[0].distance),  // meters
      };
    }
  } catch (err) {
    // OSRM offline — fallback to straight-line estimate
    const dist = haversineDistance(staffLat, staffLng, destLat, destLng);
    const avgSpeed = 8.33; // 30 km/h in m/s (city driving)
    return {
      duration: Math.round(dist / avgSpeed),
      distance: Math.round(dist),
    };
  }
  return null;
}

// ── Redis subscriber for SSE broadcast ───────────────────
async function startRedisBroadcaster() {
  await redisSub.connect();
  await redisPub.connect();

  redisSub.on('pmessage', (pattern, channel, message) => {
    const appointmentId = channel.replace('tracking:', '');
    const clients = sseClients.get(appointmentId);
    if (!clients || clients.size === 0) return;

    const parsed = JSON.parse(message);
    const eventType = parsed.type || 'message';

    for (const res of clients) {
      try {
        res.write(`event: ${eventType}\ndata: ${message}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  });

  await redisSub.psubscribe('tracking:*');
  console.log('[Tracking] Redis subscriber active on tracking:*');
}

// ── Start ────────────────────────────────────────────────
async function start() {
  const server = await build();
  await startRedisBroadcaster();

  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Tracking Service] Running on port ${PORT}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Tracking] Shutting down...');
    kalmanFilters.clear();
    await server.close();
    await redisPub.quit();
    await redisSub.quit();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[Tracking] Fatal:', err);
  process.exit(1);
});
