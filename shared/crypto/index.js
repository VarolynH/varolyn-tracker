'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');

// ── JWT ───────────────────────────────────────────────────
function signToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn, algorithm: 'HS256' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

// ── Password hashing (bcrypt) ─────────────────────────────
async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ── AES-256-GCM encryption (PII at rest) ─────────────────
function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(ciphertext) {
  const [ivHex, tagHex, encrypted] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── SHA-256 hashing (consent chain) ──────────────────────
function sha256(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

// ── Consent chain hash computation ───────────────────────
function computeConsentHash(prevHash, payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return sha256(`${prevHash}:${canonical}`);
}

// ── Short random token for tracking links ────────────────
function generateTrackingToken(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let token = '';
  for (let i = 0; i < length; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

// ── HMAC for webhook signatures ──────────────────────────
function hmacSign(payload) {
  return crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
}

function hmacVerify(payload, signature) {
  const expected = hmacSign(payload);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

module.exports = {
  signToken,
  verifyToken,
  hashPassword,
  comparePassword,
  encrypt,
  decrypt,
  sha256,
  computeConsentHash,
  generateTrackingToken,
  hmacSign,
  hmacVerify,
};
