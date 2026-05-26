'use strict';

const { Pool } = require('pg');
const Redis = require('ioredis');

// ── PostgreSQL pool (singleton) ───────────────────────────
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'varolyn_tracker',
      user: process.env.POSTGRES_USER || 'varolyn',
      password: process.env.POSTGRES_PASSWORD || 'varolyn_dev_pass',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

// Helper: run a query
async function query(text, params) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) {
    console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 80));
  }
  return result;
}

// Helper: get a single row
async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

// Helper: transaction wrapper
async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Redis (singleton) ────────────────────────────────────
let redis;
let redisSub;

function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 300,
      lazyConnect: true,
    });
    redis.on('error', (err) => {
      console.error('[Redis] Error:', err.message);
    });
  }
  return redis;
}

function getRedisSub() {
  if (!redisSub) {
    redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redisSub.on('error', (err) => {
      console.error('[Redis-Sub] Error:', err.message);
    });
  }
  return redisSub;
}

// ── Graceful shutdown ────────────────────────────────────
async function shutdown() {
  if (pool) await pool.end();
  if (redis) redis.disconnect();
  if (redisSub) redisSub.disconnect();
}

module.exports = {
  getPool,
  query,
  queryOne,
  transaction,
  getRedis,
  getRedisSub,
  shutdown,
};
