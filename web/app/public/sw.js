/* ═══════════════════════════════════════════════════════
 *  Varolyn Healthcare — Service Worker v9 IRON LOCK
 *  PERSISTENT notification keeps Android from killing Chrome.
 *  This is how Uber/Google Maps work — you MUST have a visible
 *  notification for background location on Android/iOS.
 *  Without it, the OS kills the browser within seconds.
 * ═══════════════════════════════════════════════════════ */

const CACHE = 'varolyn-v9';
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

// ══════════════════════════════════════════════════════
//  PERSISTENT NOTIFICATION — keeps Android from killing Chrome
//  This is NOT optional. Without this, Android kills background
//  processes within seconds of the user closing the browser.
// ══════════════════════════════════════════════════════
async function showPersistentNotification() {
  try {
    await self.registration.showNotification('Varolyn Healthcare', {
      tag: 'varolyn-persistent',
      body: 'Location tracking active',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      silent: true,
      renotify: false,
      requireInteraction: true,  // STAYS visible — prevents Android from killing process
      ongoing: true,             // Android: makes it non-dismissable
      actions: [],               // No action buttons
      data: { action: 'persistent', persistent: true },
    });
  } catch {}
}

async function clearPersistentNotification() {
  try {
    const notifs = await self.registration.getNotifications({ tag: 'varolyn-persistent' });
    for (const n of notifs) n.close();
  } catch {}
}

// ── Install / Activate ──
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
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
  if (type === 'SET_SESSION') {
    await saveActiveSession(data);
    // Show persistent notification when session is set (tracking started)
    await showPersistentNotification();
  }
  if (type === 'CLEAR_SESSION') {
    await clearActiveSession();
    // Remove persistent notification when session is cleared (tracking stopped)
    await clearPersistentNotification();
  }
  if (type === 'SKIPWAITING') self.skipWaiting();
  if (type === 'SHOW_PERSISTENT') await showPersistentNotification();
});

// ══════════════════════════════════════════════════════
//  PUSH HANDLER — receives server push, recovers tracking
//  KEEPS persistent notification alive (Android REQUIRES this)
// ══════════════════════════════════════════════════════
self.addEventListener('push', (e) => {
  let payload = {};
  try { if (e.data) payload = e.data.json(); } catch {}

  e.waitUntil((async () => {
    const session = await getActiveSession();
    const token = payload.token || session?.token;
    const secret = session?.sessionSecret;

    // ── Always refresh the persistent notification (keeps Android process alive) ──
    if (token) {
      await showPersistentNotification();
    }

    // ── STEP 1: Heartbeat to server ──
    if (token && secret) {
      try {
        const hbRes = await fetch(self.location.origin + '/api/heartbeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, sessionSecret: secret, checks: { pushReceived: true, swAlive: true, ts: Date.now(), reason: payload.reason || 'push' } }),
        });
        if (hbRes.ok) {
          const data = await hbRes.json();
          if (data.command === 'stop') {
            await clearActiveSession(); await clearBuffer();
            await clearPersistentNotification();
            const cls = await clients.matchAll({ type: 'window' });
            for (const c of cls) c.postMessage({ type: 'ADMIN_STOP' });
            return;
          }
        }
      } catch {}
    }

    // ── STEP 2: Flush buffered locations ──
    if (token && secret) { try { await syncBufferedLocations(); } catch {} }

    // ── STEP 3: Wake ALL existing page clients ──
    let wokenClient = false;
    try {
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.postMessage({ type: 'PUSH_RESUME', token, auto: true });
          client.postMessage({ type: 'FORCE_GPS_PUSH' });
          try { await client.focus(); } catch {}
          wokenClient = true;
        }
      }
    } catch {}

    // ── STEP 4: No open tab → reopen the page ──
    if (!wokenClient) {
      try {
        await clients.openWindow(self.location.origin + '/');
        await new Promise(r => setTimeout(r, 3000));
        try {
          const cls = await clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (const c of cls) {
            if (c.url.includes(self.location.origin)) {
              c.postMessage({ type: 'PUSH_RESUME', token, auto: true });
              wokenClient = true;
            }
          }
        } catch {}
      } catch {}
    }

    // ── STEP 5: Second wake attempt ──
    if (wokenClient) {
      try {
        await new Promise(r => setTimeout(r, 5000));
        const cls = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of cls) {
          if (c.url.includes(self.location.origin)) {
            c.postMessage({ type: 'FORCE_GPS_PUSH' });
          }
        }
      } catch {}
    }

    // ── STEP 6: IP fallback only if truly no client ──
    if (!wokenClient && token && secret) {
      try {
        await fetch(self.location.origin + '/api/ip-location', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, sessionSecret: secret }),
        });
      } catch {}
    }
  })());
});

// ── Notification click — open/focus the app + resume tracking ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      // Re-show persistent notification (clicking closes it, we need it back)
      const session = await getActiveSession();
      if (session?.token) {
        await showPersistentNotification();
      }
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

// ── Notification close — re-show persistent notification (staff can't dismiss it) ──
self.addEventListener('notificationclose', async (e) => {
  const data = e.notification.data || {};
  if (data.persistent) {
    // Staff tried to dismiss the tracking notification — show it again
    const session = await getActiveSession();
    if (session?.token) {
      // Small delay to avoid notification flicker
      setTimeout(() => showPersistentNotification(), 1000);
    }
  }
});

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

  // Keep persistent notification alive
  await showPersistentNotification();

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
        await clearPersistentNotification();
        const cls = await clients.matchAll({ type: 'window' });
        for (const c of cls) c.postMessage({ type: 'ADMIN_STOP' });
        return;
      }
    }
  } catch {}

  try {
    const cls = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ourClients = cls.filter(c => c.url.includes(self.location.origin));

    if (ourClients.length > 0) {
      for (const c of ourClients) {
        c.postMessage({ type: 'FORCE_GPS_PUSH' });
        c.postMessage({ type: 'PUSH_RESUME', token: session.token, auto: true });
      }
    } else {
      try {
        await clients.openWindow(self.location.origin + '/');
        await new Promise(r => setTimeout(r, 2000));
        const newCls = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of newCls) {
          if (c.url.includes(self.location.origin)) {
            c.postMessage({ type: 'PUSH_RESUME', token: session.token, auto: true });
          }
        }
      } catch {
        await fetch(self.location.origin + '/api/ip-location', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: session.token, sessionSecret: session.sessionSecret }),
        }).catch(() => {});
      }
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
