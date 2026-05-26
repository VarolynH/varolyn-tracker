'use strict';

const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');

const PORT = parseInt(process.env.NOTIFICATION_PORT || '8085');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── Web Push (VAPID) ─────────────────────────────────────
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@varolynhealthcare.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── Email (SMTP) ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const db = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'varolyn_tracker',
  user: process.env.POSTGRES_USER || 'varolyn',
  password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
  max: 10,
});

const redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

const app = Fastify({ logger: true });

async function build() {
  await app.register(fastifyCors, { origin: true, credentials: true });

  app.get('/health', async () => ({ status: 'ok', service: 'notification' }));

  // ────────────────────────────────────────────────────────
  // POST /api/notifications/subscribe — Staff registers push subscription
  // ────────────────────────────────────────────────────────
  app.post('/api/notifications/subscribe', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth) return reply.code(401).send({ error: 'Unauthorized' });

    let decoded;
    try {
      decoded = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    if (decoded.role !== 'staff') {
      return reply.code(403).send({ error: 'Staff only' });
    }

    const { subscription } = req.body || {};
    if (!subscription || !subscription.endpoint) {
      return reply.code(400).send({ error: 'Invalid subscription object' });
    }

    // Store push subscription in staff_profiles
    await db.query(
      `UPDATE staff_profiles SET push_subscription = $1 WHERE id = $2`,
      [JSON.stringify(subscription), decoded.staffId]
    );

    return { success: true, message: 'Push subscription stored' };
  });

  // ────────────────────────────────────────────────────────
  // POST /api/notifications/send — Send a notification (admin)
  // ────────────────────────────────────────────────────────
  app.post('/api/notifications/send', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth) return reply.code(401).send({ error: 'Unauthorized' });

    let decoded;
    try {
      decoded = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const { recipientId, channel, title, body, appointmentId } = req.body || {};

    if (channel === 'web_push') {
      return await sendWebPush(recipientId, title, body, appointmentId);
    }
    if (channel === 'email') {
      const { email } = req.body;
      return await sendEmail(email, title, body, appointmentId);
    }

    return reply.code(400).send({ error: 'Unsupported channel' });
  });

  // ────────────────────────────────────────────────────────
  // GET /api/notifications/vapid-key — Public VAPID key for client
  // ────────────────────────────────────────────────────────
  app.get('/api/notifications/vapid-key', async () => {
    return { publicKey: VAPID_PUBLIC };
  });

  return app;
}

// ── Web Push sender ──────────────────────────────────────
async function sendWebPush(staffId, title, body, appointmentId) {
  const staff = await db.query(
    'SELECT push_subscription FROM staff_profiles WHERE id = $1',
    [staffId]
  );

  if (!staff.rows[0] || !staff.rows[0].push_subscription) {
    await logNotification(appointmentId, staffId, 'web_push', 'failed', null, 'No push subscription');
    return { success: false, error: 'No push subscription for staff' };
  }

  const subscription = JSON.parse(staff.rows[0].push_subscription);
  const payload = JSON.stringify({
    title: title || 'Varolyn Healthcare',
    body: body || 'New tracking session ready',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { appointmentId, url: `/staff/track/${appointmentId}` },
    actions: [
      { action: 'open', title: 'Open Tracker' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    tag: `tracking-${appointmentId}`,
    requireInteraction: true,         // Keeps notification visible
    vibrate: [200, 100, 200, 100, 200],
  });

  try {
    await webpush.sendNotification(subscription, payload, {
      TTL: 3600,
      urgency: 'high',
      topic: `tracking-${appointmentId}`,
    });
    await logNotification(appointmentId, staffId, 'web_push', 'sent', { title, body });
    return { success: true, channel: 'web_push' };
  } catch (err) {
    console.error('[Notification] Push failed:', err.message);
    // If subscription expired (410), remove it
    if (err.statusCode === 410) {
      await db.query(
        'UPDATE staff_profiles SET push_subscription = NULL WHERE id = $1',
        [staffId]
      );
    }
    await logNotification(appointmentId, staffId, 'web_push', 'failed', null, err.message);
    return { success: false, error: err.message };
  }
}

// ── Email sender ─────────────────────────────────────────
async function sendEmail(to, subject, body, appointmentId) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@varolynhealthcare.com',
      to,
      subject: subject || 'Varolyn Healthcare — Tracking Update',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #0066cc; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Varolyn Healthcare</h1>
          </div>
          <div style="padding: 20px; background: #f9f9f9;">
            ${body}
          </div>
          <div style="padding: 10px 20px; font-size: 12px; color: #666; text-align: center;">
            <p>This is an automated message from Varolyn Healthcare tracking system.</p>
            <p>You received this because you are associated with a healthcare appointment.</p>
          </div>
        </div>
      `,
    });
    await logNotification(appointmentId, null, 'email', 'sent', { to, subject });
    return { success: true, channel: 'email' };
  } catch (err) {
    console.error('[Notification] Email failed:', err.message);
    await logNotification(appointmentId, null, 'email', 'failed', null, err.message);
    return { success: false, error: err.message };
  }
}

// ── Send tracking link to patient ────────────────────────
async function sendTrackingLink(appointmentId, trackingUrl) {
  // Get patient info
  const result = await db.query(
    `SELECT p.email, p.phone, p.full_name, a.service_type, a.scheduled_at,
            u.full_name as staff_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN staff_profiles sp ON sp.id = a.staff_id
     JOIN users u ON u.id = sp.user_id
     WHERE a.id = $1`,
    [appointmentId]
  );

  if (!result.rows[0]) return;
  const patient = result.rows[0];

  // Send email
  if (patient.email) {
    const scheduledDate = new Date(patient.scheduled_at).toLocaleString('en-IN');
    await sendEmail(
      patient.email,
      `Track Your ${patient.service_type} Visit — Varolyn Healthcare`,
      `
        <h2>Hello ${patient.full_name},</h2>
        <p>Your healthcare visit is scheduled for <strong>${scheduledDate}</strong>.</p>
        <p><strong>${patient.staff_name}</strong> will be visiting you for <strong>${patient.service_type}</strong>.</p>
        <p>Click the button below to track your healthcare professional's location in real-time:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${trackingUrl}" style="background: #0066cc; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-size: 18px;">
            Track Live Location
          </a>
        </div>
        <p style="font-size: 14px; color: #666;">
          Or copy this link: ${trackingUrl}<br>
          This link expires ${parseInt(process.env.TRACKING_LINK_EXPIRY_HOURS || '4')} hours after the scheduled time.
        </p>
      `,
      appointmentId
    );
  }

  // Attempt email-to-SMS via carrier gateway (if phone known)
  if (patient.phone) {
    const carrierGateways = [
      // Indian carriers
      { pattern: /^\+91/, gateways: ['@sms.airtel.in', '@sms.jio.com'] },
      // US carriers
      { pattern: /^\+1/, gateways: ['@txt.att.net', '@tmomail.net', '@vtext.com'] },
    ];

    // Try carrier gateways (best-effort, may not work for all carriers)
    for (const { pattern, gateways } of carrierGateways) {
      if (pattern.test(patient.phone)) {
        const phoneDigits = patient.phone.replace(/\D/g, '');
        for (const gateway of gateways) {
          try {
            await transporter.sendMail({
              from: process.env.SMTP_FROM || 'noreply@varolynhealthcare.com',
              to: `${phoneDigits}${gateway}`,
              subject: '',
              text: `Varolyn Healthcare: Track your ${patient.service_type} visit here: ${trackingUrl}`,
            });
          } catch {
            // Silently fail — carrier gateway may not work
          }
        }
        break;
      }
    }
  }
}

// ── Notification logger ──────────────────────────────────
async function logNotification(appointmentId, recipientId, channel, status, payload, errorMsg) {
  try {
    await db.query(
      `INSERT INTO notification_log
        (appointment_id, recipient_id, channel, status, payload, error_message, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [appointmentId, recipientId, channel, status,
       payload ? JSON.stringify(payload) : null,
       errorMsg || null,
       status === 'sent' ? new Date() : null]
    );
  } catch (err) {
    console.error('[Notification] Log failed:', err.message);
  }
}

// ── Redis event listeners ────────────────────────────────
async function startEventListeners() {
  await redisSub.connect();

  // When appointment is created → send tracking link to patient
  redisSub.subscribe('appointment:created', 'consent:granted');

  redisSub.on('message', async (channel, message) => {
    const data = JSON.parse(message);

    if (channel === 'appointment:created') {
      console.log(`[Notification] New appointment ${data.appointmentId}, sending tracking link`);
      await sendTrackingLink(data.appointmentId, data.trackingUrl);
    }

    if (channel === 'consent:granted') {
      // Patient gave consent → notify staff to start tracking
      console.log(`[Notification] Consent granted for ${data.appointmentId}, notifying staff`);

      const appt = await db.query(
        `SELECT a.staff_id, a.service_type,
                p.full_name as patient_name, p.address_line
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.id = $1`,
        [data.appointmentId]
      );

      if (appt.rows[0]) {
        const { staff_id, patient_name, service_type, address_line } = appt.rows[0];
        await sendWebPush(
          staff_id,
          'Patient Ready for Tracking',
          `${patient_name} has consented to location tracking for their ${service_type} visit${address_line ? ` at ${address_line}` : ''}. Open the app to start sharing your location.`,
          data.appointmentId
        );
      }
    }
  });

  console.log('[Notification] Event listeners active');
}

async function start() {
  const server = await build();
  await startEventListeners();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Notification Service] Running on port ${PORT}`);

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
  console.error('[Notification] Fatal:', err);
  process.exit(1);
});
