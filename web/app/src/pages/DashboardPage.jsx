import React, { useState, useEffect, useCallback } from 'react';

const API = '';

const DURATION_OPTIONS = [
  { label: '1 Hour',    value: 1 },
  { label: '2 Hours',   value: 2 },
  { label: '4 Hours',   value: 4 },
  { label: '8 Hours',   value: 8 },
  { label: '12 Hours',  value: 12 },
  { label: '24 Hours',  value: 24 },
  { label: '2 Days',    value: 48 },
  { label: '3 Days',    value: 72 },
  { label: '7 Days',    value: 168 },
  { label: 'Custom',    value: 0 },
];

export default function DashboardPage() {
  // ── Auth state ──
  const [jwt, setJwt]             = useState(() => localStorage.getItem('varolyn_admin_jwt') || '');
  const [loginEmail, setLoginEmail]   = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError]   = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // ── Dashboard state ──
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState('');

  const isLoggedIn = !!jwt;

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // ── Login handler ──
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (!loginEmail.trim() || !loginPassword.trim())
      return setLoginError('Email and password are required');

    setLoginLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      localStorage.setItem('varolyn_admin_jwt', data.token);
      setJwt(data.token);
      setLoginEmail('');
      setLoginPassword('');
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Logout ──
  const handleLogout = () => {
    localStorage.removeItem('varolyn_admin_jwt');
    setJwt('');
    setSessions([]);
  };

  // ── Fetch dashboard (protected by JWT) ──
  const fetchDashboard = useCallback(async () => {
    if (!jwt) return;
    try {
      const res = await fetch(`${API}/api/dashboard`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {}
    setLoading(false);
  }, [jwt]);

  useEffect(() => {
    if (!isLoggedIn) { setLoading(false); return; }
    setLoading(true);
    fetchDashboard();
    const id = setInterval(fetchDashboard, 5000);
    return () => clearInterval(id);
  }, [fetchDashboard, isLoggedIn]);

  // ── Admin force-stop ──
  const adminStopSession = async (token) => {
    if (!window.confirm('Stop tracking for this staff member?')) return;
    try {
      const res = await fetch(`${API}/api/admin/stop-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ token }),
      });
      if (res.ok) { showToast('Session stopped'); fetchDashboard(); }
    } catch {}
  };

  // ── Admin update duration ──
  const updateDuration = async (token, hours) => {
    try {
      const res = await fetch(`${API}/api/admin/update-duration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ token, hours }),
      });
      if (res.ok) { showToast(`Duration updated to ${hours}h`); fetchDashboard(); }
    } catch {}
  };

  // ── Share handlers (admin only) ──
  const getTrackUrl = (token) => `${window.location.origin}/track/${token}`;

  const copyLink = (token) => {
    navigator.clipboard.writeText(getTrackUrl(token)).then(() => showToast('Tracking link copied!'));
  };

  const shareWhatsApp = (token, staffName, recipientPhone) => {
    const url = getTrackUrl(token);
    const p = (recipientPhone || '').replace(/\D/g, '');
    const msg = encodeURIComponent(`Track ${staffName}'s live location:\n${url}\n\n— Varolyn Healthcare`);
    if (p) window.open(`https://wa.me/${p}?text=${msg}`, '_blank');
    else window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  const shareGeneric = async (token, staffName) => {
    const url = getTrackUrl(token);
    if (navigator.share) {
      try { await navigator.share({ title: `Track ${staffName} — Varolyn Healthcare`, url }); } catch {}
    } else copyLink(token);
  };

  const timeAgo = (dt) => {
    if (!dt) return '';
    const sec = Math.floor((Date.now() - new Date(dt).getTime()) / 1000);
    if (sec < 10) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  const timeUntil = (dt) => {
    if (!dt) return '';
    const ms = new Date(dt).getTime() - Date.now();
    if (ms <= 0) return 'Expired';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  // ══════════════════════════════════════════════════════
  //  RENDER: LOGIN GATE
  // ══════════════════════════════════════════════════════
  if (!isLoggedIn) {
    return (
      <div className="page">
        <div className="brand">
          <h1>Varolyn Healthcare</h1>
          <p>Admin Dashboard</p>
        </div>
        <div className="card">
          <div className="login-header">
            <div className="login-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                <circle cx="12" cy="16" r="1"/>
              </svg>
            </div>
            <h2 className="login-title">Admin Login</h2>
            <p className="login-subtitle">Authorized personnel only</p>
          </div>

          {loginError && <div className="error-msg">{loginError}</div>}

          <form onSubmit={handleLogin}>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                placeholder="admin@varolynhealthcare.com"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                autoComplete="email"
                autoFocus
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                placeholder="Enter password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loginLoading}>
              {loginLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="login-footer">
            Protected by AES-256 encryption, JWT authentication, and rate limiting.
          </p>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════
  //  RENDER: DASHBOARD
  // ══════════════════════════════════════════════════════
  const activeSessions = sessions.filter(s => s.status === 'active');
  const pastSessions   = sessions.filter(s => s.status !== 'active');

  return (
    <div className="dash-page">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1>Varolyn Healthcare</h1>
          <p>Admin Control Center</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn-logout" onClick={handleLogout} title="Sign out">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="dash-stats">
        <div className="stat-card">
          <span className="stat-num">{activeSessions.length}</span>
          <span className="stat-label">Live Now</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{sessions.length}</span>
          <span className="stat-label">Total Sessions</span>
        </div>
      </div>

      {loading && <p style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>Loading...</p>}

      {/* Active Staff Cards */}
      {activeSessions.length > 0 && (
        <>
          <h2 className="dash-section-title">
            <span className="pulse-dot" style={{ width: 8, height: 8 }} /> Active Staff
          </h2>
          <div className="dash-grid">
            {activeSessions.map(s => (
              <StaffCard
                key={s.id} s={s} timeAgo={timeAgo} timeUntil={timeUntil}
                onStop={adminStopSession} onCopy={copyLink}
                onWhatsApp={shareWhatsApp} onShare={shareGeneric}
                onUpdateDuration={updateDuration}
              />
            ))}
          </div>
        </>
      )}

      {/* Past Sessions */}
      {pastSessions.length > 0 && (
        <>
          <h2 className="dash-section-title" style={{ marginTop: 32 }}>Past Sessions</h2>
          <div className="dash-grid">
            {pastSessions.map(s => (
              <StaffCard key={s.id} s={s} timeAgo={timeAgo} timeUntil={timeUntil} past onCopy={copyLink} />
            ))}
          </div>
        </>
      )}

      {!loading && sessions.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: '3rem' }}>&#128225;</p>
          <p>No tracking sessions yet.</p>
          <p style={{ fontSize: '.85rem', marginTop: 8 }}>Staff will start sessions from their devices. Tracking links will appear here.</p>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  STAFF CARD (admin-only — shows full OSINT + controls)
// ══════════════════════════════════════════════════════
function StaffCard({ s, timeAgo, timeUntil, past, onStop, onCopy, onWhatsApp, onShare, onUpdateDuration }) {
  const [showDuration, setShowDuration] = useState(false);
  const [customHours, setCustomHours]   = useState('');
  const [sharePhone, setSharePhone]     = useState(s.recipientPhone || '');
  const [showSharePanel, setShowSharePanel] = useState(false);

  const ipGeo = s.ipGeo || {};
  const dev   = s.deviceInfo || {};
  const ua    = dev.parsedUA || {};
  const bat   = s.battery || dev.battery || {};
  const net   = s.network || dev.network || {};
  const loc   = s.location;

  const ipCity = ipGeo.status !== 'fail'
    ? [ipGeo.city, ipGeo.regionName, ipGeo.countryCode || ipGeo.country].filter(Boolean).join(', ')
    : '';

  const handleDurationSelect = (hours) => {
    if (hours === 0) { setShowDuration('custom'); return; }
    onUpdateDuration(s.token, hours);
    setShowDuration(false);
  };

  const handleCustomDuration = () => {
    const h = parseFloat(customHours);
    if (h > 0 && h <= 720) { // max 30 days
      onUpdateDuration(s.token, h);
      setShowDuration(false);
      setCustomHours('');
    }
  };

  return (
    <div className={`staff-card ${past ? 'past' : ''}`}>
      {/* Header row */}
      <div className="sc-header">
        <div className="sc-status">
          {!past && <span className="pulse-dot" style={{ width: 8, height: 8 }} />}
          <span className={`sc-badge ${past ? 'off' : 'on'}`}>
            {past ? (s.status === 'expired' ? 'EXPIRED' : 'STOPPED') : 'LIVE'}
          </span>
          {!past && s.expiresAt && (
            <span className="sc-expires">Expires: {timeUntil(s.expiresAt)}</span>
          )}
        </div>
      </div>

      {/* Staff Info */}
      <h3 className="sc-name">{s.staffName}</h3>
      {s.designation && <p className="sc-desig">{s.designation}</p>}

      <div className="sc-details">
        <span>&#128222; {s.staffPhone}</span>
        <span>&#128231; {s.staffEmail}</span>
      </div>

      {/* OSINT Data */}
      <div className="sc-osint">
        {loc && (
          <div className="osint-row">
            <span className="osint-icon">&#128205;</span>
            <span>GPS: {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
              {loc.accuracy && <small> (&plusmn;{loc.accuracy.toFixed(0)}m)</small>}
            </span>
          </div>
        )}
        {loc?.updatedAt && (
          <div className="osint-row">
            <span className="osint-icon">&#128336;</span>
            <span>Updated {timeAgo(loc.updatedAt)}</span>
          </div>
        )}
        {loc?.speed > 0 && (
          <div className="osint-row">
            <span className="osint-icon">&#128663;</span>
            <span>{(loc.speed * 3.6).toFixed(0)} km/h</span>
          </div>
        )}
        {ipCity && (
          <div className="osint-row">
            <span className="osint-icon">&#127760;</span>
            <span>IP: {ipCity}</span>
          </div>
        )}
        {ipGeo.isp && ipGeo.isp !== 'Local' && (
          <div className="osint-row">
            <span className="osint-icon">&#128274;</span>
            <span>ISP: {ipGeo.isp}
              {ipGeo.mobile && ' (Mobile)'}
              {ipGeo.proxy && <span className="sc-warn"> Warning: Proxy</span>}
            </span>
          </div>
        )}
        {(ua.device || ua.os) && (
          <div className="osint-row">
            <span className="osint-icon">&#128241;</span>
            <span>{[ua.device, ua.os, ua.browser].filter(Boolean).join(' / ')}</span>
          </div>
        )}
        {bat.level != null && (
          <div className="osint-row">
            <span className="osint-icon">&#128267;</span>
            <span>{bat.level}% {bat.charging ? 'Charging' : ''}</span>
          </div>
        )}
        {net.type && (
          <div className="osint-row">
            <span className="osint-icon">&#128225;</span>
            <span>{net.type.toUpperCase()}{net.downlink ? ` | ${net.downlink} Mbps` : ''}</span>
          </div>
        )}
        {dev.screen && (
          <div className="osint-row">
            <span className="osint-icon">&#128421;</span>
            <span>Screen: {dev.screen}{dev.pixelRatio > 1 ? ` @${dev.pixelRatio}x` : ''}</span>
          </div>
        )}
        {dev.timezone && (
          <div className="osint-row">
            <span className="osint-icon">&#127757;</span>
            <span>{dev.timezone}</span>
          </div>
        )}
      </div>

      {/* ── Admin Controls (only for active sessions) ── */}
      {!past && (
        <div className="admin-controls">
          {/* Share Link Panel */}
          <button className="ctrl-btn ctrl-share" onClick={() => setShowSharePanel(!showSharePanel)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Share Tracking Link
          </button>

          {showSharePanel && (
            <div className="share-panel">
              <div className="share-panel-row">
                <input
                  type="tel" placeholder="Patient/family phone (+91...)"
                  value={sharePhone} onChange={e => setSharePhone(e.target.value)}
                  className="share-phone-input"
                />
              </div>
              <div className="share-panel-row">
                <button className="ctrl-btn ctrl-whatsapp" onClick={() => onWhatsApp(s.token, s.staffName, sharePhone)}>
                  WhatsApp
                </button>
                <button className="ctrl-btn ctrl-copy" onClick={() => onCopy(s.token)}>
                  Copy Link
                </button>
                <button className="ctrl-btn ctrl-generic" onClick={() => onShare(s.token, s.staffName)}>
                  Share
                </button>
              </div>
            </div>
          )}

          {/* Duration Control */}
          <button className="ctrl-btn ctrl-duration" onClick={() => setShowDuration(!showDuration)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            Set Duration
          </button>

          {showDuration && showDuration !== 'custom' && (
            <div className="duration-panel">
              <div className="duration-grid">
                {DURATION_OPTIONS.map(opt => (
                  <button key={opt.value} className="dur-btn" onClick={() => handleDurationSelect(opt.value)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showDuration === 'custom' && (
            <div className="duration-panel">
              <div className="custom-duration">
                <input
                  type="number" placeholder="Hours (e.g. 36)" min="0.5" max="720" step="0.5"
                  value={customHours} onChange={e => setCustomHours(e.target.value)}
                  className="share-phone-input"
                />
                <button className="ctrl-btn ctrl-copy" onClick={handleCustomDuration}>Set</button>
                <button className="ctrl-btn" onClick={() => setShowDuration(false)} style={{ background: 'var(--gray-100)' }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Stop Button */}
          <button className="ctrl-btn ctrl-stop" onClick={() => onStop(s.token)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="6" width="12" height="12" rx="1"/>
            </svg>
            Stop Tracking
          </button>
        </div>
      )}
    </div>
  );
}
