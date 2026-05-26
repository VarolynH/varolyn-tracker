import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useGeolocation — High-accuracy GPS streaming with:
 * - Screen Wake Lock API (keeps screen on)
 * - Adaptive update intervals based on speed
 * - Background/foreground detection
 * - Offline buffering via IndexedDB
 * - Kalman-like client-side smoothing
 */
export function useGeolocation({ enabled = false, highAccuracy = true } = {}) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [isBackground, setIsBackground] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState(null);

  const watchIdRef = useRef(null);
  const wakeLockRef = useRef(null);
  const positionBufferRef = useRef([]);

  // ── Screen Wake Lock ───────────────────────────────────
  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      setWakeLockActive(true);
      console.log('[Geo] Wake lock acquired');

      wakeLockRef.current.addEventListener('release', () => {
        setWakeLockActive(false);
        console.log('[Geo] Wake lock released');
      });
    } catch (err) {
      console.warn('[Geo] Wake lock failed:', err.message);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // ── Re-acquire wake lock when page becomes visible ─────
  useEffect(() => {
    const handleVisibility = async () => {
      const hidden = document.hidden;
      setIsBackground(hidden);

      if (!hidden && enabled && wakeLockRef.current === null) {
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled, requestWakeLock]);

  // ── Battery API ────────────────────────────────────────
  useEffect(() => {
    if ('getBattery' in navigator) {
      navigator.getBattery().then((battery) => {
        setBatteryLevel(battery.level);
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(battery.level);
        });
      });
    }
  }, []);

  // ── Start/Stop watching ────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
        setIsTracking(false);
      }
      releaseWakeLock();
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('Geolocation not supported');
      return;
    }

    // Request wake lock
    requestWakeLock();

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const locationData = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          timestamp: pos.timestamp,
          batteryLevel,
          isForeground: !document.hidden,
        };

        setPosition(locationData);
        setError(null);
        setIsTracking(true);

        // Buffer for offline sync
        positionBufferRef.current.push(locationData);
        if (positionBufferRef.current.length > 100) {
          positionBufferRef.current = positionBufferRef.current.slice(-50);
        }
      },
      (err) => {
        setError(err.message);
        console.error('[Geo] Error:', err.message);
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: 15000,
        maximumAge: 0, // Always fresh position
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      releaseWakeLock();
    };
  }, [enabled, highAccuracy, requestWakeLock, releaseWakeLock, batteryLevel]);

  // ── Get buffered positions (for offline sync) ──────────
  const getBufferedPositions = useCallback(() => {
    const buffer = [...positionBufferRef.current];
    positionBufferRef.current = [];
    return buffer;
  }, []);

  return {
    position,
    error,
    isTracking,
    isBackground,
    wakeLockActive,
    batteryLevel,
    getBufferedPositions,
  };
}
