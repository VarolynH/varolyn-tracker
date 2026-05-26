#!/usr/bin/env node
/**
 * Manual data purge script — GDPR/DPDP compliance.
 * Deletes location data older than CONSENT_DATA_TTL_HOURS.
 * Run via cron: 0 * * * * node /opt/varolyn-tracker/scripts/purge-expired-data.js
 */
'use strict';

const { Pool } = require('pg');

const TTL_HOURS = parseInt(process.env.CONSENT_DATA_TTL_HOURS || '24');

const db = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'varolyn_tracker',
  user: process.env.POSTGRES_USER || 'varolyn',
  password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
});

async function purge() {
  const cutoff = new Date(Date.now() - TTL_HOURS * 3600 * 1000).toISOString();
  console.log(`[Purge] Deleting data older than ${cutoff} (TTL=${TTL_HOURS}h)`);

  const loc = await db.query('DELETE FROM location_history WHERE time < $1', [cutoff]);
  const eta = await db.query('DELETE FROM eta_snapshots WHERE estimated_at < $1', [cutoff]);
  const links = await db.query(
    "UPDATE tracking_links SET is_active = false WHERE expires_at < NOW() AND is_active = true"
  );

  const total = loc.rowCount + eta.rowCount;

  await db.query(
    `INSERT INTO purge_log (purge_type, records_deleted, table_name)
     VALUES ('auto_ttl', $1, 'location_history+eta_snapshots')`,
    [total]
  );

  console.log(`[Purge] Deleted ${loc.rowCount} locations, ${eta.rowCount} ETAs, deactivated ${links.rowCount} links`);
  await db.end();
}

purge().catch((err) => { console.error('[Purge] Error:', err); process.exit(1); });
