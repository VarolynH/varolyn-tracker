import React, { useState, useEffect, useCallback } from 'react';

const API = '';

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

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

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
        // Token expired or invalid — force logout
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
    try {
      const res = await fetch(`${API}/api/admin/stop-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ token }),
      });
      if (res.ok) { showToast('Session stopped'); fetchDashboard(); }
    } catch {}
  };

  const copyLink = (token) => {
    const url = `${window.location.origin}/track/${token}`;
    navigator.clipboard.writeText(url).then(() => showToast('Link copied!'));
  };

  const timeAgo = (dt) => {
    if (!dt) return '';
    const sec = Math.floor((Date.now() - new Date(dt).getTime()) / 1000);
    if (sec < 10) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
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
          <p>Staff Tracking Dashboard</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="/" className="dash-link">+ New Session</a>
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
              <StaffCard key={s.id} s={s} copyLink={copyLink} timeAgo={timeAgo} onStop={adminStopSession} />
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
              <StaffCard key={s.id} s={s} copyLink={copyLink} timeAgo={timeAgo} past />
            ))}
          </div>
        </>
      )}

      {!loading && sessions.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: '3rem' }}>📡</p>
          <p>No tracking sessions yet.</p>
          <a href="/" style={{ color: 'var(--teal)' }}>Start a new session</a>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  STAFF CARD (admin-only — shows full OSINT data)
// ══════════════════════════════════════════════════════
function StaffCard({ s, copyLink, timeAgo, past, onStop }) {
  const ipGeo = s.ipGeo || {};
  const dev   = s.deviceInfo || {};
  const ua    = dev.parsedUA || {};
  const bat   = s.battery || dev.battery || {};
  const net   = s.network || dev.network || {};
  const loc   = s.location;

  const ipCity = ipGeo.status !== 'fail'
    ? [ipGeo.city, ipGeo.regionName, ipGeo.countryCode || ipGeo.country].filter(Boolean).join(', ')
    : '';

  return (
    <div className={`staff-card ${past ? 'past' : ''}`}>
      {/* Header row */}
      <div className="sc-header">
        <div className="sc-status">
          {!past && <span className="pulse-dot" style={{ width: 8, height: 8 }} />}
          <span className={`sc-badge ${past ? 'off' : 'on'}`}>
            {past ? (s.status === 'expired' ? 'EXPIRED' : 'STOPPED') : 'LIVE'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="sc-copy" title="Copy tracking link" onClick={() => copyLink(s.token)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </button>
          {!past && onStop && (
            <button className="sc-copy" title="Force stop session" onClick={() => onStop(s.token)}
              style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="6" width="12" height="12" rx="1"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Staff Info */}
      <h3 className="sc-name">{s.staffName}</h3>
      {s.designation && <p className="sc-desig">{s.designation}</p>}

      <div className="sc-details">
        <span>📞 {s.staffPhone}</span>
        <span>📧 {s.staffEmail}</span>
      </div>

      {/* OSINT Data */}
      <div className="sc-osint">
        {loc && (
          <div className="osint-row">
            <span className="osint-icon">📍</span>
            <span>GPS: {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
              {loc.accuracy && <small> (±{loc.accuracy.toFixed(0)}m)</small>}
            </span>
          </div>
        )}
        {loc?.updatedAt && (
          <div className="osint-row">
            <span className="osint-icon">🕐</span>
            <span>Updated {timeAgo(loc.updatedAt)}</span>
          </div>
        )}
        {loc?.speed > 0 && (
          <div className="osint-row">
            <span className="osint-icon">🚗</span>
            <span>{(loc.speed * 3.6).toFixed(0)} km/h</span>
          </div>
        )}
        {ipCity && (
          <div className="osint-row">
            <span className="osint-icon">🌐</span>
            <span>IP: {ipCity}</span>
          </div>
        )}
        {ipGeo.isp && ipGeo.isp !== 'Local' && (
          <div className="osint-row">
            <span className="osint-icon">🔒</span>
            <span>ISP: {ipGeo.isp}
              {ipGeo.mobile && ' (Mobile)'}
              {ipGeo.proxy && <span className="sc-warn"> ⚠ Proxy</span>}
            </span>
          </div>
        )}
        {(ua.device || ua.os) && (
          <div className="osint-row">
            <span className="osint-icon">📱</span>
            <span>{[ua.device, ua.os, ua.browser].filter(Boolean).join(' / ')}</span>
          </div>
        )}
        {bat.level != null && (
          <div className="osint-row">
            <span className="osint-icon">🔋</span>
            <span>{bat.level}% {bat.charging ? '⚡ Charging' : ''}</span>
          </div>
        )}
        {net.type && (
          <div className="osint-row">
            <span className="osint-icon">📡</span>
            <span>{net.type.toUpperCase()}{net.downlink ? ` | ${net.downlink} Mbps` : ''}</span>
          </div>
        )}
        {dev.screen && (
          <div className="osint-row">
            <span className="osint-icon">🖥️</span>
            <span>Screen: {dev.screen}{dev.pixelRatio > 1 ? ` @${dev.pixelRatio}x` : ''}</span>
          </div>
        )}
        {dev.timezone && (
          <div className="osint-row">
            <span className="osint-icon">🌍</span>
            <span>{dev.timezone}</span>
          </div>
        )}
      </div>
    </div>
  );
}
