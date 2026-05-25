import React, { useState, useRef, useEffect, useCallback } from 'react';

const API = '';

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

  const wsRef      = useRef(null);
  const watchRef   = useRef(null);
  const secretRef  = useRef(null);
  const wakeLockRef = useRef(null);
  const [gpsInfo, setGpsInfo]   = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [elapsed, setElapsed]   = useState(0);
  const startTimeRef = useRef(null);

  // keep secretRef in sync
  useEffect(() => { secretRef.current = sessionSecret; }, [sessionSecret]);

  // ── Elapsed timer ─────────────────────────────────────
  useEffect(() => {
    if (!isLive) return;
    startTimeRef.current = Date.now();
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(s);
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

  // ── Wake Lock — prevent device sleep ──────────────────
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          // Re-acquire on visibility change
        });
      }
    } catch {}
  };
  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };
  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && isLive) requestWakeLock();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [isLive]);

  // ── Start Session ─────────────────────────────────────
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
      startGPS(data.token);
      connectWS(data.token, data.sessionSecret);
      requestWakeLock();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // ── Cleanup when stopped by admin ─────────────────────
  const handleAdminStop = useCallback(() => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    releaseWakeLock();
    setIsLive(false);
    setStoppedByAdmin(true);
    setGpsInfo(null);
    setWsStatus('disconnected');
  }, []);

  // ── GPS ───────────────────────────────────────────────
  const startGPS = useCallback((tok) => {
    if (!navigator.geolocation) return setError('GPS not supported');
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, speed: pos.coords.speed,
          heading: pos.coords.heading,
        };
        setGpsInfo(loc);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const msg = { type: 'location', ...loc };
          try {
            if (navigator.getBattery) {
              navigator.getBattery().then(b => {
                msg.battery = { level: Math.round(b.level * 100), charging: b.charging };
                if (navigator.connection) {
                  const c = navigator.connection;
                  msg.network = { type: c.effectiveType || '', downlink: c.downlink || 0, rtt: c.rtt || 0 };
                }
                wsRef.current?.send(JSON.stringify(msg));
              });
            } else {
              wsRef.current.send(JSON.stringify(msg));
            }
          } catch { wsRef.current?.send(JSON.stringify(msg)); }
        }
      },
      (err) => setError(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }, []);

  // ── WebSocket (sends auth message with sessionSecret) ──
  const connectWS = useCallback((tok, secret) => {
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
        if (m.type === 'connected')    setWsStatus('connected');
        if (m.type === 'ack')          setWsStatus('connected');
        if (m.type === 'auth_required') {} // waiting for our auth message
        if (m.type === 'session_ended') {
          // Admin stopped the session
          handleAdminStop();
          return;
        }
        if (m.error) { setWsStatus('auth_failed'); ws.close(); }
      } catch {}
    };

    ws.onclose = () => {
      // Only reconnect if still supposed to be live
      if (!wsRef.current) return;
      setWsStatus('reconnecting');
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState > 1) {
          connectWS(tok, secretRef.current);
        }
      }, 3000);
    };
    ws.onerror = () => setWsStatus('error');
  }, [handleAdminStop]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (wsRef.current) wsRef.current.close();
    releaseWakeLock();
  }, []);

  // ── Render: Stopped by Admin ──────────────────────────
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

  // ── Render: Form ──────────────────────────────────────
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

  // ── Render: Live Tracking (no stop button, no share link) ──
  return (
    <div className="page">
      <div className="brand"><h1>Varolyn Healthcare</h1></div>
      <div className="card">
        <div className="status-bar live">
          <span className="pulse-dot" />
          Tracking Active
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
            <span className="tstat-label">Status</span>
            <span className="tstat-value tstat-live">
              <span className="pulse-dot" style={{ width: 6, height: 6 }} /> Live
            </span>
          </div>
          <div className="tstat">
            <span className="tstat-label">Connection</span>
            <span className={`tstat-value ${wsStatus === 'connected' ? 'tstat-live' : 'tstat-warn'}`}>
              {wsStatus === 'connected' ? 'Connected' : wsStatus === 'reconnecting' ? 'Reconnecting...' : wsStatus}
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

        <div className="admin-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>Tracking is managed by admin. Keep this page open — your screen will stay awake.</span>
        </div>
      </div>
    </div>
  );
}
