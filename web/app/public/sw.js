/* ═══════════════════════════════════════════════════════
 *  Varolyn Healthcare — Service Worker
 *  Background tracking, offline buffer, auto-resume
 * ═══════════════════════════════════════════════════════ */

const CACHE = 'varolyn-v3';
const ASSETS = ['/', '/manifest.json'];
const DB_NAME = 'varolyn_offline';
const STORE = 'location_buffer';

// ── IndexedDB helpers (for offline location buffering) ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
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

// ── Message handler: receive location data from main page ──
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
    // Just acknowledging — keeps SW alive
    e.source.postMessage({ type: 'ALIVE' });
  }
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

  try {
    const res = await fetch('/api/batch-locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: items }),
    });
    if (res.ok) await clearBuffer();
  } catch {}
}

// ── Notification click handler (brings app to foreground) ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
