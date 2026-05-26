import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/staff/' });
      console.log('[Staff PWA] SW registered:', reg.scope);

      // Register periodic background sync (Chrome Android with installed PWA)
      if ('periodicSync' in reg) {
        try {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
          if (status.state === 'granted') {
            await reg.periodicSync.register('location-heartbeat', {
              minInterval: 60 * 1000, // 1 minute minimum (browser may increase)
            });
            console.log('[Staff PWA] Periodic sync registered');
          }
        } catch (err) {
          console.warn('[Staff PWA] Periodic sync not available:', err.message);
        }
      }
    } catch (err) {
      console.error('[Staff PWA] SW registration failed:', err);
    }
  });

  // Listen for SW messages (e.g., RESUME_TRACKING from notification click)
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'RESUME_TRACKING') {
      window.dispatchEvent(new CustomEvent('resume-tracking'));
    }
  });
}

createRoot(document.getElementById('root')).render(<App />);
