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
  const [expiresAt, setExpiresAt]   = useState(null);
  const [timeLeft, setTimeLeft]     = useState('');
  const [isLive, setIsLive]         = useState(false);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [toast, setToast]           = useState('');

  const [recipientPhone, setRecipientPhone] = useState('');

  const wsRef    = useRef(null);
  const watchRef = useRef(null);
  const secretRef = useRef(null);       // keep secret in ref for callbacks
  const [gpsInfo, setGpsInfo]   = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');

  const shareUrl = token ? `${window.location.origin}/track/${token}` : '';

  // keep secretRef in sync
  useEffect(() => { secretRef.current = sessionSecret; }, [sessionSecret]);

  // ── Countdown ─────────────────────────────────────────
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const d = new Date(expiresAt) - Date.now();
      if (d <= 0) { setTimeLeft('Expired'); handleStop(); return; }
      const h = Math.floor(d / 3600000);
      const m = Math.floor((d % 3600000) / 60000);
      const s = Math.floor((d % 60000) / 1000);
      setTimeLeft(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

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
      setExpiresAt(data.expiresAt);
      setIsLive(true);
      startGPS(data.token);
      connectWS(data.token, data.sessionSecret);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // ── Stop Session (requires sessionSecret) ─────────────
  const handleStop = async () => {
    try {
      await fetch(`${API}/api/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, sessionSecret: secretRef.current }),
      });
    } catch {}
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setIsLive(false); setToken(null); setSecret(null);
    setExpiresAt(null); setGpsInfo(null); setWsStatus('disconnected');
    showToast('Location sharing stopped');
  };

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
      // Server expects auth message with sessionSecret first
      ws.send(JSON.stringify({ type: 'auth', sessionSecret: secret }));
    };

    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'connected')    setWsStatus('connected');
        if (m.type === 'ack')          setWsStatus('connected');
        if (m.type === 'auth_required') {} // waiting for our auth message
        if (m.error) { setWsStatus('auth_failed'); ws.close(); }
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('reconnecting');
      setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState > 1) {
          connectWS(tok, secretRef.current);
        }
      }, 3000);
    };
    ws.onerror = () => setWsStatus('error');
  }, []);

  // ── Share handlers ────────────────────────────────────
  const handleCopy = () => navigator.clipboard.writeText(shareUrl).then(() => showToast('Link copied!'));
  const handleWhatsApp = () => {
    const p = recipientPhone.replace(/\D/g, '');
    const m = encodeURIComponent(`Track my live location:\n${shareUrl}\n\n— ${name}, Varolyn Healthcare`);
    window.open(`https://wa.me/${p}?text=${m}`, '_blank');
  };
  const handleSMS = () => {
    window.open(`sms:${recipientPhone}?body=${encodeURIComponent(`Track my live location: ${shareUrl}`)}`, '_blank');
  };
  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Live Location — Varolyn Healthcare', url: shareUrl }); } catch {}
    } else handleCopy();
  };

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (wsRef.current) wsRef.current.close();
  }, []);

  // ── Render: Form ──────────────────────────────────────
  if (!isLive) {
    return (
      <div className="page">
        <div className="brand">
          <h1>Varolyn Healthcare</h1>
          <p>Live Location Sharing</p>
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
            <span>I consent to share my live GPS location for this session. Location data is encrypted, auto-deleted after 4 hours, and complies with DPDP 2023 &amp; GDPR.</span>
          </label>
          <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
            {loading ? 'Starting...' : 'Start Sharing Location'}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Live ──────────────────────────────────────
  return (
    <div className="page">
      <div className="brand"><h1>Varolyn Healthcare</h1></div>
      <div className="card">
        <div className="status-bar live"><span className="pulse-dot" />Live — Sharing Your Location</div>
        {error && <div className="error-msg">{error}</div>}

        <div className="share-section" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
          <h3>Send tracking link to recipient</h3>
          <div className="field" style={{ marginBottom: 8 }}>
            <input type="tel" placeholder="Recipient's phone (+91...)" value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} />
          </div>
          <div className="share-row">
            <button className="share-btn whatsapp" onClick={handleWhatsApp} disabled={!recipientPhone.trim()}>WhatsApp</button>
            <button className="share-btn" onClick={handleSMS} disabled={!recipientPhone.trim()}>SMS</button>
          </div>
          <div className="share-row" style={{ marginTop: 8 }}>
            <button className="share-btn" onClick={handleCopy}>Copy Link</button>
            <button className="share-btn" onClick={handleShare}>Share</button>
          </div>
          <div className="link-box" style={{ marginTop: 12 }}>
            <input value={shareUrl} readOnly />
          </div>
        </div>

        <div className="timer">Session expires in: <strong>{timeLeft}</strong></div>

        {gpsInfo && (
          <div className="gps-debug">
            GPS: {gpsInfo.lat.toFixed(6)}, {gpsInfo.lng.toFixed(6)}<br />
            Accuracy: {gpsInfo.accuracy?.toFixed(0)}m | Speed: {gpsInfo.speed != null ? (gpsInfo.speed * 3.6).toFixed(1) + ' km/h' : '—'}<br />
            WebSocket: {wsStatus}
          </div>
        )}

        <button className="btn btn-danger" onClick={handleStop} style={{ marginTop: 20 }}>Stop Sharing</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
