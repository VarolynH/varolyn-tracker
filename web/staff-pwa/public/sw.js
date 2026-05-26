/**
 * Varolyn Staff PWA — Service Worker
 *
 * CRITICAL: Background location tracking strategy
 * ================================================
 * Web browsers suspend JS when tab is backgrounded/screen locked.
 * This SW uses a layered fallback approach:
 *
 * Layer 1: Periodic Background Sync (Chrome Android with installed PWA)
 *   - Fires every ~15 min minimum
 *   - Cannot access Geolocation API directly in SW
 *   - Triggers a push notification prompting staff to reopen the app
 *
 * Layer 2: Web Push Notifications
 *   - Server sends periodic "heartbeat" push if no location received for 2+ min
 *   - High-priority notification with "Open Tracker" action
 *   - Clicking opens the PWA → immediately resumes location streaming
 *
 * Layer 3: Background Fetch API (experimental)
 *   - Can keep a fetch alive in the background
 *   - Used to maintain a long-lived connection to the server
 *
 * HONEST LIMITATION:
 * No web technology can provide continuous background GPS like a native app.
 * The system gracefully degrades: shows last-known position + timestamp,
 * and actively nudges staff to return to the foreground.
 */

const CACHE_NAME = 'varolyn-staff-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── Install ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch (network-first for API, cache-first for static) ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: always network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/') || url.pathname.startsWith('/sse/')) {
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Push Notification ────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Varolyn Healthcare', body: 'Open the tracker to share your location.' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'varolyn-tracking',
    requireInteraction: true,
    actions: data.actions || [
      { action: 'open', title: 'Open Tracker' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    data: data.data || {},
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification Click ───────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || '/staff/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // If staff app is already open, focus it
      for (const client of clients) {
        if (client.url.includes('/staff') && 'focus' in client) {
          // Send message to resume tracking
          client.postMessage({ type: 'RESUME_TRACKING' });
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(urlToOpen);
    })
  );
});

// ── Periodic Background Sync ─────────────────────────────
// Available on Chrome Android when PWA is installed
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'location-heartbeat') {
    event.waitUntil(handlePeriodicSync());
  }
});

async function handlePeriodicSync() {
  // Cannot access Geolocation in SW.
  // Strategy: Check if there's a stored location that hasn't been sent,
  // and send it. Also show a notification if tracking is active.

  try {
    // Check IndexedDB for pending locations
    const pendingLocations = await getPendingLocations();

    if (pendingLocations.length > 0) {
      // Batch send pending locations
      const response = await fetch('/api/tracking/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations: pendingLocations }),
      });

      if (response.ok) {
        await clearPendingLocations();
      }
    }

    // Check if we should nudge staff to open the app
    const trackingState = await getTrackingState();
    if (trackingState && trackingState.active) {
      const lastUpdate = trackingState.lastLocationTime || 0;
      const staleness = Date.now() - lastUpdate;

      // If no location for 3+ minutes, show notification
      if (staleness > 180000) {
        await self.registration.showNotification('Location Sharing Paused', {
          body: 'Please open the Varolyn Tracker to resume sharing your location.',
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
          tag: 'location-resume',
          requireInteraction: true,
          vibrate: [200, 100, 200],
          actions: [{ action: 'open', title: 'Resume Tracking' }],
          data: { url: '/staff/', type: 'resume' },
        });
      }
    }
  } catch (err) {
    console.error('[SW] Periodic sync error:', err);
  }
}

// ── Background Sync (one-shot, for sending buffered locations) ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'send-buffered-locations') {
    event.waitUntil(sendBufferedLocations());
  }
});

async function sendBufferedLocations() {
  const locations = await getPendingLocations();
  if (locations.length === 0) return;

  try {
    const state = await getTrackingState();
    if (!state || !state.token || !state.appointmentId) return;

    const response = await fetch(`/api/tracking/${state.appointmentId}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ locations }),
    });

    if (response.ok) {
      await clearPendingLocations();
    }
  } catch (err) {
    console.error('[SW] Sync failed:', err);
    // Will retry automatically
  }
}

// ── IndexedDB helpers for offline location buffer ────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('varolyn-staff', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending-locations')) {
        db.createObjectStore('pending-locations', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('tracking-state')) {
        db.createObjectStore('tracking-state');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPendingLocations() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('pending-locations', 'readonly');
    const store = tx.objectStore('pending-locations');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function clearPendingLocations() {
  const db = await openDB();
  const tx = db.transaction('pending-locations', 'readwrite');
  tx.objectStore('pending-locations').clear();
}

async function getTrackingState() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('tracking-state', 'readonly');
    const req = tx.objectStore('tracking-state').get('current');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

// ── Message from main thread ─────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
