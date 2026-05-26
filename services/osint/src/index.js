'use strict';

const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const PORT = parseInt(process.env.OSINT_PORT || '8086');

// Uses DB-IP Lite or GeoLite2 MMDB (free, downloaded separately)
let reader = null;
async function loadGeoIP() {
  try {
    const maxmind = require('maxmind');
    const dbPath = process.env.GEOIP_DB_PATH || '/data/dbip-city-lite.mmdb';
    reader = await maxmind.open(dbPath);
    console.log('[OSINT] GeoIP database loaded');
  } catch {
    console.warn('[OSINT] GeoIP database not found — IP geolocation disabled');
  }
}

const app = Fastify({ logger: true });

async function build() {
  await app.register(fastifyCors, { origin: true });
  app.get('/health', async () => ({ status: 'ok', service: 'osint', geoipAvailable: reader !== null }));

  // ── IP Geolocation ─────────────────────────────────────
  app.get('/api/osint/geoip/:ip', async (req, reply) => {
    if (!reader) return reply.code(503).send({ error: 'GeoIP database not loaded' });
    const result = reader.get(req.params.ip);
    if (!result) return reply.code(404).send({ error: 'IP not found in database' });
    return {
      ip: req.params.ip,
      country: result.country?.iso_code,
      city: result.city?.names?.en,
      lat: result.location?.latitude,
      lng: result.location?.longitude,
      accuracy: result.location?.accuracy_radius,
    };
  });

  return app;
}

async function start() {
  await loadGeoIP();
  const server = await build();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[OSINT Service] Running on port ${PORT}`);
}

start().catch((err) => { console.error('[OSINT] Fatal:', err); process.exit(1); });
