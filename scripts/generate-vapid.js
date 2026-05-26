#!/usr/bin/env node
/**
 * Generate VAPID keys for Web Push notifications.
 * Run: node scripts/generate-vapid.js
 * Copy the output into your .env file.
 */
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('=== VAPID Keys Generated ===');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('');
console.log('Add these to your .env file.');
