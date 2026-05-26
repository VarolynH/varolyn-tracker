import { useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * usePushNotifications — Register for Web Push with VAPID
 */
export function usePushNotifications({ token }) {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState(null);

  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Not supported');
      return false;
    }

    try {
      // Get VAPID public key from server
      const vapidRes = await fetch(`${API_BASE}/api/notifications/vapid-key`);
      const { publicKey } = await vapidRes.json();

      if (!publicKey) {
        console.warn('[Push] No VAPID key configured');
        return false;
      }

      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[Push] Permission denied');
        return false;
      }

      // Get SW registration
      const reg = await navigator.serviceWorker.ready;

      // Check existing subscription
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        // Convert VAPID key
        const applicationServerKey = urlBase64ToUint8Array(publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      // Send subscription to server
      const res = await fetch(`${API_BASE}/api/notifications/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });

      if (res.ok) {
        setIsSubscribed(true);
        setSubscription(sub);
        console.log('[Push] Subscribed successfully');
        return true;
      }
    } catch (err) {
      console.error('[Push] Subscription failed:', err);
    }
    return false;
  }, [token]);

  return { isSubscribed, subscription, subscribe };
}

// ── VAPID key conversion ─────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
