/* ═══════════════════════════════════════════════════════
 *  Varolyn Healthcare — Service Worker
 *  Background tracking, offline buffer, push recovery, auto-resume
 * ═══════════════════════════════════════════════════════ */

const CACHE = 'varolyn-v4';
const ASSETS = ['/', '/manifest.json'];
const DB_NAME = 'varolyn_offline';
const STORE = 'location_buffer';
const SESSION_STORE = 'active_session';

// ── IndexedDB helpers ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function bufferLocation(data) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ ...data, bufferedAt: Date.now() });
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch {}
}

async function getBufferedLocations() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => { db.close(); resolve(req.result || []); };
      req.onerror = () => { db.close(); resolve([]); };
    });
  } catch { return []; }
}

async function clearBuffer() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  } catch {}
}

// ── Session persistence in SW ──
async function saveActiveSession(session) {
  try {
    const db = await openDB();
    const tx = db.transaction(SESSION_STORE, 'readwrite');
    tx.objectStore(SESSION_STORE).put({ key: 'current', ...session });
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  } catch {}
}

async function getActiveSession() {
  try {
    const db = await openDB();
    const tx = db.transaction(SESSION_STORE, 'readonly');
    return new Promise((resolve) => {
      const req = tx.objectStore(SESSION_STORE).get('current');
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch { return null; }
}

async function clearActiveSession() {
  try {
    const db = await openDB();
    const tx = db.transaction(SESSION_STORE, 'readwrite');
    tx.objectStore(SESSION_STORE).delete('current');
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  } catch {}
}

// ── Install/Activate ──
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch (cache-first for static, network-first for API) ──
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws/') || e.request.url.includes('/sse/')) return;

  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached)
    )
  );
});

// ── Message handler from main page ──
self.addEventListener('message', async (e) => {
  const { type, data } = e.data || {};

  if (type === 'BUFFER_LOCATION') {
    await bufferLocation(data);
  }

  if (type === 'GET_BUFFER') {
    const items = await getBufferedLocations();
    e.source.postMessage({ type: 'BUFFERED_LOCATIONS', data: items });
  }

  if (type === 'CLEAR_BUFFER') {
    await clearBuffer();
  }

  if (type === 'KEEPALIVE') {
    e.source.postMessage({ type: 'ALIVE' });
  }

  // Main page tells us about active session for background recovery
  if (type === 'SET_SESSION') {
    await saveActiveSession(data);
  }

  if (type === 'CLEAR_SESSION') {
    await clearActiveSession();
  }
});

// ══════════════════════════════════════════════════════
//  PUSH NOTIFICATION — server sends when staff goes offline
// ══════════════════════════════════════════════════════
self.addEventListener('push', (e) => {
  let payload = { title: 'Varolyn Healthcare', body: 'Tracking session needs attention' };
  try {
    if (e.data) payload = e.data.json();
  } catch {
    try { payload.body = e.data.text(); } catch {}
  }

  const options = {
    body: payload.body || 'Your tracking session needs to resume. Tap to reopen.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'varolyn-tracking-recovery',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: '/',
      token: payload.token || null,
      action: payload.action || 'resume',
    },
    actions: [
      { action: 'open', title: 'Open Tracker' },
    ],
  };

  e.waitUntil(
    self.registration.showNotification(payload.title || 'Varolyn Healthcare', options)
  );
});

// ── Notification click — bring app to foreground / reopen tab ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const urlToOpen = e.notification.data?.url || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      // Try to focus an existing tab
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          await client.focus();
          // Tell the page to resume tracking
          client.postMessage({ type: 'PUSH_RESUME' });
          return;
        }
      }
      // No existing tab — open a new one (this is the auto-reopen on phone restart)
      if (clients.openWindow) {
        const win = await clients.openWindow(urlToOpen);
        // The page will auto-resume via localStorage check on mount
        return win;
      }
    })
  );
});

// ── Periodic Background Sync (Chrome 80+) ──
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'varolyn-location-sync') {
    e.waitUntil(syncBufferedLocations());
  }
});

// ── Regular Background Sync (when coming back online) ──
self.addEventListener('sync', (e) => {
  if (e.tag === 'varolyn-sync') {
    e.waitUntil(syncBufferedLocations());
  }
});

async function syncBufferedLocations() {
  const items = await getBufferedLocations();
  if (items.length === 0) return;

  // Get session info for auth
  const session = await getActiveSession();
  if (!session || !session.token || !session.sessionSecret) return;

  try {
    const res = await fetch('/api/batch-locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: session.token,
        sessionSecret: session.sessionSecret,
        locations: items.map(i => ({
          lat: i.lat, lng: i.lng, accuracy: i.accuracy,
          speed: i.speed, heading: i.heading,
          battery: i.battery, network: i.network, ts: i.ts || i.bufferedAt,
        })),
      }),
    });
    if (res.ok) await clearBuffer();
  } catch {}
}
