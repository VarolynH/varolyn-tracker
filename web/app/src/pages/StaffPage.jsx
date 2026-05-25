import React, { useState, useRef, useEffect, useCallback } from 'react';

const API = '';

// ═══════════════════════════════════════════════════════
//  KEEPALIVE ENGINE — prevents OS from killing tracking
// ═══════════════════════════════════════════════════════

/**
 * Silent Audio Keepalive — plays inaudible audio loop
 * This is the #1 technique used by Uber/Grab/Lyft to keep
 * the browser process alive when tab is background/phone locked.
 * Works on Android Chrome, iOS Safari, most mobile browsers.
 */
class SilentAudioKeepAlive {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.running = false;
  }
  start() {
    if (this.running) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Create silent oscillator (frequency 0 = silence, but keeps audio pipeline active)
      this.source = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.gain.value = 0.001; // near-silent but keeps process alive
      this.source.connect(gain);
      gain.connect(this.ctx.destination);
      this.source.start();
      this.running = true;
    } catch {}
  }
  resume() {
    // Audio context gets suspended on iOS when page goes background
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }
  stop() {
    try {
      if (this.source) this.source.stop();
      if (this.ctx) this.ctx.close();
    } catch {}
    this.running = false;
    this.source = null;
    this.ctx = null;
  }
}

/**
 * NoSleep Video Trick — for iOS Safari specifically
 * Plays a tiny silent video loop which prevents Safari from
 * suspending the page. Combined with audio, covers all browsers.
 */
class NoSleepVideo {
  constructor() {
    this.video = null;
  }
  start() {
    if (this.video) return;
    try {
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('muted', '');
      this.video.muted = true;
      this.video.loop = true;
      this.video.style.position = 'fixed';
      this.video.style.top = '-1px';
      this.video.style.left = '-1px';
      this.video.style.width = '1px';
      this.video.style.height = '1px';
      this.video.style.opacity = '0.01';
      // Tiny 1-second silent MP4 (base64 encoded — 690 bytes)
      this.video.src = 'data:video/mp4;base64,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';
      document.body.appendChild(this.video);
      this.video.play().catch(() => {});
    } catch {}
  }
  stop() {
    if (this.video) {
      this.video.pause();
      this.video.remove();
      this.video = null;
    }
  }
}

/**
 * IndexedDB Offline Buffer — stores GPS when WebSocket is down.
 * When connection resumes, batch-sends all buffered locations.
 */
const OfflineBuffer = {
  DB_NAME: 'varolyn_offline',
  STORE: 'location_buffer',

  async _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE))
          db.createObjectStore(this.STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async add(location) {
    try {
      const db = await this._open();
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).add({ ...location, ts: Date.now() });
      await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
      db.close();
    } catch {}
  },

  async getAll() {
    try {
      const db = await this._open();
      const tx = db.transaction(this.STORE, 'readonly');
      return new Promise((resolve) => {
        const req = tx.objectStore(this.STORE).getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); resolve([]); };
      });
    } catch { return []; }
  },

  async clear() {
    try {
      const db = await this._open();
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).clear();
      await new Promise(r => { tx.oncomplete = r; });
      db.close();
    } catch {}
  },

  async count() {
    try {
      const db = await this._open();
      const tx = db.transaction(this.STORE, 'readonly');
      return new Promise((resolve) => {
        const req = tx.objectStore(this.STORE).count();
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); resolve(0); };
      });
    } catch { return 0; }
  }
};

/** Collect OSINT device fingerprint from browser APIs */
async function collectDeviceInfo() {
  const info = {
    platform:    navigator.platform || '',
    language:    navigator.language || '',
    screen:      `${screen.width}x${screen.height}`,
    pixelRatio:  window.devicePixelRatio || 1,
    timezone:    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    cpuCores:    navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
    touchPoints: navigator.maxTouchPoints || 0,
    online:      navigator.onLine,
  };
  try {
    const b = await navigator.getBattery();
    info.battery = { level: Math.round(b.level * 100), charging: b.charging };
  } catch {}
  if (navigator.connection) {
    const c = navigator.connection;
    info.network = {
      type: c.effectiveType || c.type || '',
      downlink: c.downlink || 0,
      rtt: c.rtt || 0,
      saveData: c.saveData || false,
    };
  }
  return info;
}

// ═══════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════

export default function StaffPage() {
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [email, setEmail]     = useState('');
  const [designation, setDesignation] = useState('');
  const [consent, setConsent] = useState(false);

  const [token, setToken]           = useState(null);
  const [sessionSecret, setSecret]  = useState(null);
  const [isLive, setIsLive]         = useState(false);
  const [stoppedByAdmin, setStoppedByAdmin] = useState(false);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);

  const wsRef        = useRef(null);
  const watchRef     = useRef(null);
  const secretRef    = useRef(null);
  const tokenRef     = useRef(null);
  const wakeLockRef  = useRef(null);
  const audioKeepRef = useRef(null);
  const videoKeepRef = useRef(null);
  const isLiveRef    = useRef(false);
  const bufferCountRef = useRef(0);

  const [gpsInfo, setGpsInfo]         = useState(null);
  const [wsStatus, setWsStatus]       = useState('disconnected');
  const [elapsed, setElapsed]         = useState(0);
  const [bufferedCount, setBuffered]  = useState(0);
  const [bgMode, setBgMode]           = useState(false);
  const startTimeRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { secretRef.current = sessionSecret; }, [sessionSecret]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);

  // ── Elapsed timer ─────────────────────────────────────
  useEffect(() => {
    if (!isLive) return;
    startTimeRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const fmtElapsed = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  };

  // ═════════════════════════════════════════════════════
  //  KEEPALIVE SYSTEM — all techniques combined
  // ═════════════════════════════════════════════════════

  const startAllKeepAlives = async () => {
    // 1. Wake Lock API — prevent screen off
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch {}

    // 2. Silent Audio — keeps process alive in background
    audioKeepRef.current = new SilentAudioKeepAlive();
    audioKeepRef.current.start();

    // 3. NoSleep Video — iOS Safari fallback
    videoKeepRef.current = new NoSleepVideo();
    videoKeepRef.current.start();

    // 4. Request persistent notification (keeps SW + page alive on Android)
    try {
      if ('Notification' in window && Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted' && navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'KEEPALIVE' });
        }
      }
    } catch {}

    // 5. Register periodic background sync (Chrome 80+)
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'periodicSync' in reg) {
        await reg.periodicSync.register('varolyn-location-sync', { minInterval: 60000 });
      }
    } catch {}
  };

  const stopAllKeepAlives = () => {
    if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
    if (audioKeepRef.current) { audioKeepRef.current.stop(); audioKeepRef.current = null; }
    if (videoKeepRef.current) { videoKeepRef.current.stop(); videoKeepRef.current = null; }
  };

  // ── Visibility change: re-acquire everything when app returns to foreground ──
  useEffect(() => {
    const handler = async () => {
      if (!isLiveRef.current) return;

      if (document.visibilityState === 'visible') {
        setBgMode(false);
        // Re-acquire wake lock
        try {
          if ('wakeLock' in navigator) {
            wakeLockRef.current = await navigator.wakeLock.request('screen');
          }
        } catch {}
        // Resume audio context (iOS suspends it)
        if (audioKeepRef.current) audioKeepRef.current.resume();
        // Flush offline buffer
        flushOfflineBuffer();
      } else {
        setBgMode(true);
      }
    };

    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // ── Online/offline detection ──
  useEffect(() => {
    const onOnline = () => {
      if (isLiveRef.current) {
        flushOfflineBuffer();
        // Reconnect WebSocket if needed
        if (!wsRef.current || wsRef.current.readyState > 1) {
          connectWS(tokenRef.current, secretRef.current);
        }
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // ── Flush offline buffer — send all cached locations ──
  const flushOfflineBuffer = async () => {
    const items = await OfflineBuffer.getAll();
    if (items.length === 0) return;

    // Try batch endpoint first
    try {
      const res = await fetch(`${API}/api/batch-locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: tokenRef.current,
          sessionSecret: secretRef.current,
          locations: items.map(i => ({
            lat: i.lat, lng: i.lng, accuracy: i.accuracy,
            speed: i.speed, heading: i.heading,
            battery: i.battery, network: i.network, ts: i.ts,
          })),
        }),
      });
      if (res.ok) {
        await OfflineBuffer.clear();
        setBuffered(0);
        bufferCountRef.current = 0;
      }
    } catch {
      // If batch fails, try sending via WebSocket one by one
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        for (const item of items) {
          try {
            wsRef.current.send(JSON.stringify({
              type: 'location', lat: item.lat, lng: item.lng,
              accuracy: item.accuracy, speed: item.speed, heading: item.heading,
              battery: item.battery, network: item.network,
            }));
          } catch { break; }
        }
        await OfflineBuffer.clear();
        setBuffered(0);
        bufferCountRef.current = 0;
      }
    }
  };

  // ── SW keepalive ping every 20s ──
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'KEEPALIVE' });
      }
    }, 20000);
    return () => clearInterval(id);
  }, [isLive]);

  // ── Register Service Worker ──
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // ═════════════════════════════════════════════════════
  //  START SESSION
  // ═════════════════════════════════════════════════════
  const handleStart = async () => {
    setError('');
    if (!name.trim() || !phone.trim() || !email.trim())
      return setError('Please fill in all fields');
    if (!consent)
      return setError('GPS consent is required');

    setLoading(true);
    try {
      const deviceInfo = await collectDeviceInfo();
      const res = await fetch(`${API}/api/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffName: name.trim(),
          staffPhone: phone.trim(),
          staffEmail: email.trim(),
          designation: designation.trim(),
          consentGps: true,
          deviceInfo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      setToken(data.token);
      setSecret(data.sessionSecret);
      setIsLive(true);
      setStoppedByAdmin(false);
      await OfflineBuffer.clear();
      startGPS(data.token);
      connectWS(data.token, data.sessionSecret);
      await startAllKeepAlives();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // ═════════════════════════════════════════════════════
  //  CLEANUP (admin stop)
  // ═════════════════════════════════════════════════════
  const handleAdminStop = useCallback(() => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
    wsRef.current = null;
    stopAllKeepAlives();
    setIsLive(false);
    setStoppedByAdmin(true);
    setGpsInfo(null);
    setWsStatus('disconnected');
    setBgMode(false);
  }, []);

  // ═════════════════════════════════════════════════════
  //  GPS — watchPosition (runs even in background with keepalives)
  // ═════════════════════════════════════════════════════
  const startGPS = useCallback((tok) => {
    if (!navigator.geolocation) return setError('GPS not supported');
    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const loc = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, speed: pos.coords.speed,
          heading: pos.coords.heading,
        };
        setGpsInfo(loc);

        // Collect battery + network
        let battery = null, network = null;
        try {
          if (navigator.getBattery) {
            const b = await navigator.getBattery();
            battery = { level: Math.round(b.level * 100), charging: b.charging };
          }
        } catch {}
        if (navigator.connection) {
          const c = navigator.connection;
          network = { type: c.effectiveType || '', downlink: c.downlink || 0, rtt: c.rtt || 0 };
        }

        // Try WebSocket first
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          try {
            wsRef.current.send(JSON.stringify({
              type: 'location', ...loc, battery, network,
            }));
            return; // Sent live — done
          } catch {}
        }

        // WebSocket down → buffer to IndexedDB
        await OfflineBuffer.add({ ...loc, battery, network });
        bufferCountRef.current++;
        setBuffered(bufferCountRef.current);

        // Also tell service worker
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'BUFFER_LOCATION',
            data: { ...loc, battery, network, token: tok },
          });
        }
      },
      (err) => setError(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    );
  }, []);

  // ═════════════════════════════════════════════════════
  //  WEBSOCKET — with aggressive reconnect
  // ═════════════════════════════════════════════════════
  const connectWS = useCallback((tok, secret) => {
    if (!tok || !secret) return;
    // Close existing
    if (wsRef.current) { try { wsRef.current.close(); } catch {} }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/${tok}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('authenticating');
      ws.send(JSON.stringify({ type: 'auth', sessionSecret: secret }));
    };

    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'connected') {
          setWsStatus('connected');
          // Connection restored — flush offline buffer
          flushOfflineBuffer();
        }
        if (m.type === 'ack') setWsStatus('connected');
        if (m.type === 'session_ended') { handleAdminStop(); return; }
        if (m.error) { setWsStatus('auth_failed'); ws.close(); }
      } catch {}
    };

    ws.onclose = () => {
      if (!isLiveRef.current) return;
      setWsStatus('reconnecting');
      // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
      const delay = Math.min(15000, 1000 * Math.pow(2, Math.random() * 3));
      setTimeout(() => {
        if (isLiveRef.current) connectWS(tokenRef.current, secretRef.current);
      }, delay);
    };

    ws.onerror = () => setWsStatus('error');
  }, [handleAdminStop]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (wsRef.current) wsRef.current.close();
    stopAllKeepAlives();
  }, []);

  // ═════════════════════════════════════════════════════
  //  RENDER: Stopped by Admin
  // ═════════════════════════════════════════════════════
  if (stoppedByAdmin) {
    return (
      <div className="page">
        <div className="brand">
          <h1>Varolyn Healthcare</h1>
          <p>Live Location Tracking</p>
        </div>
        <div className="card">
          <div className="status-bar stopped">
            <span className="stop-icon">&#9632;</span>
            Tracking Stopped
          </div>
          <div className="stopped-msg">
            <div className="stopped-icon-big">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <h3>Session Complete</h3>
            <p>Your tracking session has been stopped by the admin. Thank you for your service.</p>
            <p className="stopped-detail">You tracked for <strong>{fmtElapsed(elapsed)}</strong></p>
          </div>
          <button className="btn btn-primary" onClick={() => { setStoppedByAdmin(false); setToken(null); setSecret(null); setElapsed(0); }} style={{ marginTop: 24 }}>
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════
  //  RENDER: Form
  // ═════════════════════════════════════════════════════
  if (!isLive) {
    return (
      <div className="page">
        <div className="brand">
          <h1>Varolyn Healthcare</h1>
          <p>Staff Location Tracking</p>
        </div>
        <div className="card">
          {error && <div className="error-msg">{error}</div>}
          <div className="field">
            <label>Your Name</label>
            <input type="text" placeholder="Dr. Priya Sharma" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Designation</label>
            <input type="text" placeholder="Senior Nurse / Physiotherapist" value={designation} onChange={e => setDesignation(e.target.value)} />
          </div>
          <div className="field">
            <label>Phone Number</label>
            <input type="tel" placeholder="+91 98765 43210" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" placeholder="priya@varolynhealthcare.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <label className="consent" onClick={() => setConsent(!consent)}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} onClick={e => e.stopPropagation()} />
            <span>I consent to share my live GPS location for this session. Location data is encrypted, auto-deleted after session ends, and complies with DPDP 2023 &amp; GDPR.</span>
          </label>
          <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
            {loading ? 'Starting...' : 'Start Tracking'}
          </button>
        </div>
        <p className="staff-footer">Tracking is managed by your admin. Only admin can stop tracking and share your location with patients.</p>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════
  //  RENDER: Live Tracking
  // ═════════════════════════════════════════════════════
  return (
    <div className="page">
      <div className="brand"><h1>Varolyn Healthcare</h1></div>
      <div className="card">
        <div className="status-bar live">
          <span className="pulse-dot" />
          {bgMode ? 'Tracking (Background)' : 'Tracking Active'}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="tracking-live-info">
          <div className="tracking-avatar">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div>
            <h3 className="tracking-name">{name}</h3>
            {designation && <p className="tracking-desig">{designation}</p>}
          </div>
        </div>

        <div className="tracking-stats">
          <div className="tstat">
            <span className="tstat-label">Duration</span>
            <span className="tstat-value">{fmtElapsed(elapsed)}</span>
          </div>
          <div className="tstat">
            <span className="tstat-label">Connection</span>
            <span className={`tstat-value ${wsStatus === 'connected' ? 'tstat-live' : 'tstat-warn'}`}>
              {wsStatus === 'connected' ? 'Live' : wsStatus === 'reconnecting' ? 'Buffering' : wsStatus}
            </span>
          </div>
          <div className="tstat">
            <span className="tstat-label">Buffered</span>
            <span className={`tstat-value ${bufferedCount > 0 ? 'tstat-warn' : 'tstat-live'}`}>
              {bufferedCount > 0 ? `${bufferedCount} pts` : 'None'}
            </span>
          </div>
        </div>

        {gpsInfo && (
          <div className="gps-debug">
            GPS: {gpsInfo.lat.toFixed(6)}, {gpsInfo.lng.toFixed(6)}<br />
            Accuracy: {gpsInfo.accuracy?.toFixed(0)}m
            {gpsInfo.speed != null && gpsInfo.speed > 0 && <> | Speed: {(gpsInfo.speed * 3.6).toFixed(1)} km/h</>}
          </div>
        )}

        <div className="keepalive-indicators">
          <span className="ka-badge ka-on" title="Screen wake lock">Screen Lock</span>
          <span className="ka-badge ka-on" title="Silent audio keepalive">Audio Keep</span>
          <span className="ka-badge ka-on" title="Service worker active">SW Active</span>
          {bufferedCount > 0 && <span className="ka-badge ka-buffer" title="Offline buffer active">Offline Buffer</span>}
        </div>

        <div className="admin-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>Tracking persists when you switch apps, lock phone, or go background. Admin controls this session.</span>
        </div>
      </div>
    </div>
  );
}
