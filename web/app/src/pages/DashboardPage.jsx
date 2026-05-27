import React, { useState, useEffect, useCallback, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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

const MOVEMENT_LABELS = {
  idle: 'Idle', walking: 'Walking', slow_vehicle: 'Slow Vehicle',
  vehicle: 'Vehicle', suspicious_speed: 'Suspicious Speed', unknown: 'Unknown',
};
const MOVEMENT_COLORS = {
  idle: '#ef4444', walking: '#22c55e', slow_vehicle: '#f59e0b',
  vehicle: '#3b82f6', suspicious_speed: '#dc2626', unknown: '#9ca3af',
};
const SEVERITY_COLORS = { critical: '#dc2626', high: '#f97316', medium: '#f59e0b', low: '#3b82f6' };

export default function DashboardPage() {
  const [jwt, setJwt]             = useState(() => localStorage.getItem('varolyn_admin_jwt') || '');
  const [loginEmail, setLoginEmail]   = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError]   = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [alerts, setAlerts]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState('');
  const [view, setView]         = useState('cards'); // 'cards' | 'heatmap'

  const isLoggedIn = !!jwt;

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (!loginEmail.trim() || !loginPassword.trim()) return setLoginError('Email and password are required');
    setLoginLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('varolyn_admin_jwt', data.token);
      setJwt(data.token); setLoginEmail(''); setLoginPassword('');
    } catch (err) { setLoginError(err.message); }
    finally { setLoginLoading(false); }
  };

  const handleLogout = () => { localStorage.removeItem('varolyn_admin_jwt'); setJwt(''); setSessions([]); setAlerts([]); };

  const fetchDashboard = useCallback(async () => {
    if (!jwt) return;
    try {
      const res = await fetch(`${API}/api/dashboard`, { headers: { Authorization: `Bearer ${jwt}` } });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('varolyn_admin_jwt'); setJwt(''); setSessions([]); setAlerts([]); setLoading(false); return;
      }
      const data = await res.json();
      setSessions(data.sessions || []);
      setAlerts(data.alerts || []);
    } catch (err) { console.warn('[Dashboard] Fetch error:', err.message); }
    setLoading(false);
  }, [jwt]);

  useEffect(() => {
    if (!isLoggedIn) { setLoading(false); return; }
    setLoading(true); fetchDashboard();
    const id = setInterval(fetchDashboard, 5000);
    return () => clearInterval(id);
  }, [fetchDashboard, isLoggedIn]);

  const adminStopSession = async (token) => {
    if (!window.confirm('Stop tracking for this staff member?')) return;
    try {
      const res = await fetch(`${API}/api/admin/stop-session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ token }),
      });
      if (res.ok) { showToast('Session stopped'); fetchDashboard(); }
    } catch {}
  };

  const adminWakePush = async (token) => {
    try {
      const res = await fetch(`${API}/api/admin/wake-push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      showToast(data.message || (data.success ? 'Wake push sent' : 'Push failed'));
    } catch { showToast('Wake push failed'); }
  };

  const [routeModal, setRouteModal] = useState(null); // { token, staffName }
  const viewRoute = (token, staffName) => setRouteModal({ token, staffName });

  const updateDuration = async (token, hours) => {
    try {
      const res = await fetch(`${API}/api/admin/update-duration`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ token, hours }),
      });
      if (res.ok) { showToast(`Duration updated to ${hours}h`); fetchDashboard(); }
    } catch {}
  };

  const getTrackUrl = (token) => `${window.location.origin}/track/${token}`;
  const copyLink = (token) => { navigator.clipboard.writeText(getTrackUrl(token)).then(() => showToast('Tracking link copied!')); };
  const shareWhatsApp = (token, staffName, recipientPhone) => {
    const url = getTrackUrl(token);
    const p = (recipientPhone || '').replace(/\D/g, '');
    const msg = encodeURIComponent(`Track ${staffName}'s live location:\n${url}\n\n— Varolyn Healthcare`);
    if (p) window.open(`https://wa.me/${p}?text=${msg}`, '_blank');
    else window.open(`https://wa.me/?text=${msg}`, '_blank');
  };
  const shareGeneric = async (token, staffName) => {
    const url = getTrackUrl(token);
    if (navigator.share) { try { await navigator.share({ title: `Track ${staffName} — Varolyn Healthcare`, url }); } catch {} }
    else copyLink(token);
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
    const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  // ══════════════════════════════════════════════════════
  //  LOGIN
  // ══════════════════════════════════════════════════════
  if (!isLoggedIn) {
    return (
      <div className="page">
        <div className="brand"><h1>Varolyn Healthcare</h1><p>Admin Dashboard</p></div>
        <div className="card">
          <div className="login-header">
            <div className="login-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/>
              </svg>
            </div>
            <h2 className="login-title">Admin Login</h2>
            <p className="login-subtitle">Authorized personnel only</p>
          </div>
          {loginError && <div className="error-msg">{loginError}</div>}
          <form onSubmit={handleLogin}>
            <div className="field"><label>Email</label><input type="email" placeholder="admin@varolynhealthcare.com" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} autoComplete="email" autoFocus /></div>
            <div className="field"><label>Password</label><input type="password" placeholder="Enter password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} autoComplete="current-password" /></div>
            <button className="btn btn-primary" type="submit" disabled={loginLoading}>{loginLoading ? 'Signing in...' : 'Sign In'}</button>
          </form>
          <p className="login-footer">Protected by AES-256 encryption, JWT authentication, and rate limiting.</p>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════
  //  DASHBOARD
  // ══════════════════════════════════════════════════════
  const activeSessions = sessions.filter(s => s.status === 'active');
  const pastSessions   = sessions.filter(s => s.status !== 'active');
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');

  return (
    <div className="dash-page">
      {/* Header */}
      <div className="dash-header" style={{ background: 'var(--teal)', color: '#fff', borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 20 }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: '1.3rem', margin: 0 }}>Varolyn Healthcare</h1>
          <p style={{ color: 'rgba(255,255,255,0.8)', margin: '4px 0 0', fontSize: '.85rem' }}>Intelligence Command Center</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn-logout" onClick={handleLogout} title="Sign out">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="dash-stats">
        <div className="stat-card"><span className="stat-num">{activeSessions.length}</span><span className="stat-label">Live Now</span></div>
        <div className="stat-card"><span className="stat-num">{sessions.length}</span><span className="stat-label">Total</span></div>
        <div className="stat-card" style={criticalAlerts.length > 0 ? { borderColor: '#dc2626', background: '#fef2f2' } : {}}>
          <span className="stat-num" style={criticalAlerts.length > 0 ? { color: '#dc2626' } : {}}>{alerts.length}</span>
          <span className="stat-label">Alerts</span>
        </div>
      </div>

      {/* View Toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`ctrl-btn ${view === 'cards' ? 'ctrl-share' : ''}`} onClick={() => setView('cards')} style={view === 'cards' ? { background: 'var(--teal)', color: '#fff' } : {}}>
          Staff Cards
        </button>
        <button className={`ctrl-btn ${view === 'heatmap' ? 'ctrl-share' : ''}`} onClick={() => setView('heatmap')} style={view === 'heatmap' ? { background: 'var(--teal)', color: '#fff' } : {}}>
          Heatmap View
        </button>
      </div>

      {/* Intelligence Alerts Banner */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: '.9rem', color: '#64748b', marginBottom: 8 }}>Intelligence Alerts</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {alerts.slice(0, 8).map(a => {
              const staffName = sessions.find(s => s.token === a.token)?.staffName || a.token;
              return (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  background: a.severity === 'critical' ? '#fef2f2' : a.severity === 'high' ? '#fff7ed' : '#fffbeb',
                  border: `1px solid ${SEVERITY_COLORS[a.severity] || '#e5e7eb'}`,
                  borderRadius: 8, fontSize: '.82rem',
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEVERITY_COLORS[a.severity], flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{safe(staffName)}</span>
                  <span style={{ color: '#64748b' }}>{formatAlertType(a.alert_type)}</span>
                  <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: '.75rem' }}>{timeAgo(a.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div className="pulse-dot" style={{ width: 16, height: 16, margin: '0 auto 16px' }} />
          <p style={{ color: '#9ca3af' }}>Loading sessions...</p>
        </div>
      )}

      {/* HEATMAP VIEW */}
      {view === 'heatmap' && !loading && (
        <HeatmapView sessions={activeSessions} allSessions={sessions} />
      )}

      {/* CARDS VIEW */}
      {view === 'cards' && (
        <>
          {activeSessions.length > 0 && (
            <>
              <h2 className="dash-section-title"><span className="pulse-dot" style={{ width: 8, height: 8 }} /> Active Staff</h2>
              <div className="dash-grid">
                {activeSessions.map(s => (
                  <StaffCard key={s.id} s={s} timeAgo={timeAgo} timeUntil={timeUntil}
                    onStop={adminStopSession} onCopy={copyLink}
                    onWhatsApp={shareWhatsApp} onShare={shareGeneric}
                    onUpdateDuration={updateDuration} onWakePush={adminWakePush}
                    onViewRoute={viewRoute} />
                ))}
              </div>
            </>
          )}

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
              <p style={{ fontSize: '.85rem', marginTop: 8 }}>Staff will start sessions from their devices.</p>
            </div>
          )}
        </>
      )}

      {routeModal && (
        <RouteModal
          token={routeModal.token}
          staffName={routeModal.staffName}
          jwt={jwt}
          onClose={() => setRouteModal(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  ROUTE MODAL — shows full movement trail for one staff
// ══════════════════════════════════════════════════════
function RouteModal({ token, staffName, jwt, onClose }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/admin/route/${token}`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        if (!res.ok) { setError('Failed to load route'); setLoading(false); return; }
        const data = await res.json();
        setRouteData(data);
      } catch { setError('Network error'); }
      setLoading(false);
    })();
  }, [token, jwt]);

  useEffect(() => {
    if (!routeData || !mapContainer.current || mapRef.current) return;
    const points = routeData.route;
    if (points.length === 0) return;

    const center = [points[points.length - 1].lng, points[points.length - 1].lat];
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center,
      zoom: 14,
      attributionControl: true,
      failIfMajorPerformanceCaveat: false,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      const coords = points.map(p => [p.lng, p.lat]);
      // Route line
      map.addSource('admin-route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
      });
      map.addLayer({
        id: 'admin-route-glow', type: 'line', source: 'admin-route',
        paint: { 'line-color': '#0d9488', 'line-width': 10, 'line-opacity': 0.15 },
      });
      map.addLayer({
        id: 'admin-route-line', type: 'line', source: 'admin-route',
        paint: { 'line-color': '#0d9488', 'line-width': 3, 'line-opacity': 0.9 },
      });

      // Start marker (green)
      if (coords.length > 0) {
        const startEl = document.createElement('div');
        startEl.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);';
        new maplibregl.Marker({ element: startEl }).setLngLat(coords[0]).addTo(map);
      }
      // End marker (teal with pulse)
      if (coords.length > 1) {
        const endEl = document.createElement('div');
        endEl.innerHTML = '<div style="position:relative;width:20px;height:20px;"><div style="position:absolute;inset:0;border-radius:50%;background:rgba(13,148,136,.3);animation:hmPulse 2s infinite;"></div><div style="position:absolute;top:4px;left:4px;width:12px;height:12px;border-radius:50%;background:#0d9488;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);"></div></div>';
        new maplibregl.Marker({ element: endEl }).setLngLat(coords[coords.length - 1]).addTo(map);
      }

      // Fit bounds
      if (coords.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach(c => bounds.extend(c));
        map.fitBounds(bounds, { padding: 50, maxZoom: 16 });
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [routeData]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ width: '90vw', maxWidth: 700, maxHeight: '85vh', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{safe(staffName)} — Route History</h3>
            {routeData && <p style={{ margin: '2px 0 0', fontSize: '.8rem', color: '#64748b' }}>{routeData.count} GPS points recorded</p>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#9ca3af', padding: '4px 8px' }}>&times;</button>
        </div>
        {loading && <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>Loading route data...</div>}
        {error && <div style={{ padding: 60, textAlign: 'center', color: '#ef4444' }}>{error}</div>}
        {routeData && routeData.route.length === 0 && <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>No GPS points recorded yet for this session.</div>}
        {routeData && routeData.route.length > 0 && (
          <div ref={mapContainer} style={{ width: '100%', height: 450 }} />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  HEATMAP VIEW — All staff on map with heatmap + markers
//  Uses OpenStreetMap raster tiles (100% reliable, free)
// ══════════════════════════════════════════════════════

// Map style using CartoDB Voyager tiles — free, reliable, no API key, CORS-friendly
const MAP_STYLE = {
  version: 8,
  sources: {
    'carto-tiles': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  layers: [{ id: 'base-tiles', type: 'raster', source: 'carto-tiles' }],
};

function HeatmapView({ sessions, allSessions }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapError, setMapError] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const staffWithLocation = allSessions.filter(s => s.location && s.location.lat && s.location.lng);

  // Initialize map once
  useEffect(() => {
    if (!mapContainer.current) return;
    if (mapRef.current) return; // already initialized

    const center = staffWithLocation.length > 0
      ? [staffWithLocation[0].location.lng, staffWithLocation[0].location.lat]
      : [78.9629, 20.5937];

    let map;
    try {
      map = new maplibregl.Map({
        container: mapContainer.current,
        style: MAP_STYLE,
        center,
        zoom: staffWithLocation.length > 0 ? 13 : 5,
        attributionControl: true,
        failIfMajorPerformanceCaveat: false,
      });
    } catch (err) {
      console.error('[HeatmapView] Map init error:', err);
      setMapError(true);
      return;
    }

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      setMapReady(true);
      updateMap(map, staffWithLocation);
    });

    map.on('error', (e) => {
      console.warn('[HeatmapView] Map error:', e.error?.message || e.message || 'unknown');
      // Don't set mapError for tile-level errors (404 on individual tiles);
      // only set it for fatal style/source errors
      if (e.error?.message?.includes('style') || e.error?.message?.includes('source')) {
        setMapError(true);
      }
    });

    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Update markers + heatmap when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      updateMap(map, staffWithLocation);
    } catch (err) {
      console.warn('[HeatmapView] updateMap error:', err);
    }
  }, [sessions, allSessions, mapReady]);

  function updateMap(map, staffList) {
    if (!map) return;
    // Ensure map style is loaded before adding layers/sources
    try { if (!map.isStyleLoaded()) return; } catch { return; }

    // Remove old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    if (staffList.length === 0) {
      // Clear heatmap data if no staff
      try { if (map.getSource('staff-heat')) map.getSource('staff-heat').setData({ type: 'FeatureCollection', features: [] }); } catch {}
      return;
    }

    // GeoJSON data
    const geojson = {
      type: 'FeatureCollection',
      features: staffList.map(s => ({
        type: 'Feature',
        properties: { name: s.staffName, risk: s.riskScore || 0 },
        geometry: { type: 'Point', coordinates: [s.location.lng, s.location.lat] },
      })),
    };

    // Add/update heatmap layer
    try {
      if (map.getSource('staff-heat')) {
        map.getSource('staff-heat').setData(geojson);
      } else {
        map.addSource('staff-heat', { type: 'geojson', data: geojson });
        map.addLayer({
          id: 'heatmap-layer', type: 'heatmap', source: 'staff-heat',
          paint: {
            'heatmap-weight': 1,
            'heatmap-intensity': 1.5,
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 20, 12, 40, 16, 60],
            'heatmap-opacity': 0.55,
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,255,0)', 0.1, 'rgb(65,182,196)', 0.3, 'rgb(127,205,187)',
              0.5, 'rgb(199,233,180)', 0.7, 'rgb(255,255,178)', 0.85, 'rgb(254,178,76)', 1, 'rgb(240,59,32)',
            ],
          },
        });
      }
    } catch (err) {
      console.warn('[HeatmapView] Heatmap layer error:', err);
    }

    // Add markers for each staff
    for (const s of staffList) {
      const isActive = s.status === 'active';
      const mvColor = MOVEMENT_COLORS[s.movementState || 'unknown'];
      const riskHigh = (s.riskScore || 0) > 40;
      const initial = (s.staffName || '?')[0].toUpperCase();

      const el = document.createElement('div');
      const size = isActive ? 36 : 24;
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;cursor:pointer;position:relative;background:${isActive ? mvColor : '#9ca3af'};border:3px solid ${riskHigh ? '#dc2626' : '#fff'};box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:${isActive?14:11}px;color:#fff;font-weight:700;z-index:${isActive?10:5};`;
      el.textContent = initial;

      if (isActive) {
        const ring = document.createElement('div');
        ring.style.cssText = `position:absolute;inset:-4px;border-radius:50%;border:2px solid ${mvColor};animation:hmPulse 2s infinite;pointer-events:none;`;
        el.appendChild(ring);
      }
      if (riskHigh) {
        const dot = document.createElement('div');
        dot.style.cssText = 'position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;background:#dc2626;border:2px solid #fff;';
        el.appendChild(dot);
      }

      const speedKmh = s.location.speed ? (Number(s.location.speed) * 3.6).toFixed(0) : null;
      const popup = new maplibregl.Popup({ offset: 20, maxWidth: '280px' }).setHTML(`
        <div style="font-family:system-ui,sans-serif;padding:4px 0;">
          <div style="font-weight:700;font-size:15px;margin-bottom:2px;">${safe(s.staffName)}</div>
          ${s.designation ? `<div style="color:#64748b;font-size:12px;margin-bottom:6px;">${safe(s.designation)}</div>` : ''}
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
            <span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${mvColor};color:#fff;">${MOVEMENT_LABELS[s.movementState||'unknown']}</span>
            ${speedKmh ? `<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#e0f2fe;color:#0369a1;">${speedKmh} km/h</span>` : ''}
            ${(s.riskScore||0) > 0 ? `<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${riskHigh?'#fef2f2':'#fffbeb'};color:${riskHigh?'#dc2626':'#b45309'};border:1px solid ${riskHigh?'#fca5a5':'#fcd34d'};">Risk ${s.riskScore}</span>` : ''}
          </div>
          <div style="font-size:12px;color:#475569;line-height:1.6;">
            GPS: ${Number(s.location.lat).toFixed(5)}, ${Number(s.location.lng).toFixed(5)}<br/>
            ${s.location.accuracy ? `Accuracy: &plusmn;${Number(s.location.accuracy).toFixed(0)}m<br/>` : ''}
          </div>
          <div style="margin-top:4px;font-size:11px;color:#9ca3af;">Token: ${s.token} &middot; ${s.status}</div>
        </div>
      `);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([s.location.lng, s.location.lat])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
    }

    // Fit bounds
    if (staffList.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      staffList.forEach(s => bounds.extend([s.location.lng, s.location.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    } else {
      map.flyTo({ center: [staffList[0].location.lng, staffList[0].location.lat], zoom: 14 });
    }
  }

  if (staffWithLocation.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#f9fafb', borderRadius: 12 }}>
        <p style={{ fontSize: '2.5rem', marginBottom: 8 }}>&#127758;</p>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>No GPS data available</p>
        <p style={{ fontSize: '.85rem' }}>Staff need to start a tracking session with GPS enabled to appear on the map.</p>
      </div>
    );
  }

  if (mapError) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#ef4444', background: '#fef2f2', borderRadius: 12, border: '1px solid #fecaca' }}>
        <p style={{ fontSize: '2rem', marginBottom: 8 }}>&#9888;&#65039;</p>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Map failed to load</p>
        <p style={{ fontSize: '.85rem', color: '#64748b' }}>Check your internet connection or try refreshing the page.</p>
        <button onClick={() => { setMapError(false); mapRef.current = null; }} className="ctrl-btn" style={{ marginTop: 12, background: 'var(--teal)', color: '#fff', padding: '8px 20px' }}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <style>{`@keyframes hmPulse{0%{transform:scale(1);opacity:.7}50%{transform:scale(1.6);opacity:0}100%{transform:scale(1);opacity:0}} .maplibregl-popup-content{border-radius:10px!important;box-shadow:0 4px 20px rgba(0,0,0,.15)!important;padding:12px 14px!important;} .maplibregl-canvas{outline:none;}`}</style>
      <div ref={mapContainer} style={{ width: '100%', height: 450, borderRadius: 12, overflow: 'hidden', border: '2px solid #e5e7eb' }} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: '.78rem', color: '#64748b' }}>
        {Object.entries(MOVEMENT_LABELS).filter(([k]) => k !== 'unknown').map(([key, label]) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: MOVEMENT_COLORS[key], flexShrink: 0 }} /> {label}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', border: '3px solid #dc2626', flexShrink: 0 }} /> High Risk
        </span>
      </div>
    </div>
  );
}

// ── Helper functions ──
function safe(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(safe).join(', ');
  if (typeof val === 'object') { try { return JSON.stringify(val); } catch { return '[object]'; } }
  return String(val);
}

function formatAlertType(type) {
  const map = {
    teleportation: 'Teleportation Jump',
    impossible_speed: 'Impossible Speed',
    mock_gps_suspect: 'Mock GPS Detected',
    automation_detected: 'Automation/Bot Detected',
    devtools_open: 'Developer Tools Open',
    prolonged_idle: 'Prolonged Idle',
  };
  return map[type] || type.replace(/_/g, ' ');
}

// ══════════════════════════════════════════════════════
//  STAFF CARD (admin-only — shows OSINT + controls + intelligence)
// ══════════════════════════════════════════════════════
function StaffCard({ s, timeAgo, timeUntil, past, onStop, onCopy, onWhatsApp, onShare, onUpdateDuration, onWakePush, onViewRoute }) {
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

  const screenStr = !dev.screen ? '' :
    typeof dev.screen === 'string' ? dev.screen :
    (dev.screen.width && dev.screen.height) ? `${dev.screen.width}x${dev.screen.height}` : '';

  const lastUpdateMs = loc?.updatedAt ? Date.now() - new Date(loc.updatedAt).getTime() : Infinity;
  const isOffline = !past && s.status === 'active' && lastUpdateMs > 60000;

  // Movement & Intelligence
  const mvState = s.movementState || 'unknown';
  const riskScore = s.riskScore || 0;
  const intelFlags = s.intelFlags || {};

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
    if (h > 0 && h <= 720) { onUpdateDuration(s.token, h); setShowDuration(false); setCustomHours(''); }
  };

  return (
    <div className={`staff-card ${past ? 'past' : ''}`}>
      {/* Header */}
      <div className="sc-header">
        <div className="sc-status">
          {!past && !isOffline && <span className="pulse-dot" style={{ width: 8, height: 8 }} />}
          <span className={`sc-badge ${past ? 'off' : isOffline ? 'offline' : 'on'}`}>
            {past ? (s.status === 'expired' ? 'EXPIRED' : 'STOPPED') : isOffline ? 'OFFLINE' : 'LIVE'}
          </span>
          {!past && s.expiresAt && <span className="sc-expires">Expires: {timeUntil(s.expiresAt)}</span>}
        </div>
      </div>

      {/* Intelligence Badges */}
      {!past && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 600, background: MOVEMENT_COLORS[mvState], color: '#fff' }}>
            {MOVEMENT_LABELS[mvState]}
          </span>
          {loc?.speed > 0 && (
            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 600, background: '#e0f2fe', color: '#0369a1' }}>
              {(Number(loc.speed) * 3.6).toFixed(0)} km/h
            </span>
          )}
          {riskScore > 0 && (
            <span style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 600,
              background: riskScore > 40 ? '#fef2f2' : '#fffbeb',
              color: riskScore > 40 ? '#dc2626' : '#b45309',
              border: `1px solid ${riskScore > 40 ? '#fca5a5' : '#fcd34d'}`,
            }}>
              Risk: {riskScore}
            </span>
          )}
          {intelFlags.mockGps && (
            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 700, background: '#dc2626', color: '#fff' }}>
              MOCK GPS
            </span>
          )}
          {intelFlags.automation && (
            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 700, background: '#7c3aed', color: '#fff' }}>
              BOT
            </span>
          )}
        </div>
      )}

      {isOffline && (
        <div className="sc-offline-banner"><span className="pulse-warn" /> Staff device offline <span className="sc-lastseen">Last seen: {timeAgo(loc?.updatedAt)}</span></div>
      )}

      <h3 className="sc-name">{s.staffName}</h3>
      {s.designation && <p className="sc-desig">{s.designation}</p>}

      <div className="sc-details">
        <span>&#128222; {s.staffPhone}</span>
        <span>&#128231; {s.staffEmail}</span>
      </div>

      {/* OSINT Data */}
      <div className="sc-osint">
        {loc && (
          <div className="osint-row"><span className="osint-icon">&#128205;</span>
            <span>GPS: {Number(loc.lat).toFixed(5)}, {Number(loc.lng).toFixed(5)}
              {loc.accuracy && <small> (&plusmn;{Number(loc.accuracy).toFixed(0)}m)</small>}
            </span>
          </div>
        )}
        {loc?.updatedAt && (
          <div className="osint-row"><span className="osint-icon">&#128336;</span>
            <span>Updated {safe(timeAgo(loc.updatedAt))}{isOffline ? ' (OFFLINE)' : ''}</span>
          </div>
        )}
        {ipCity && (
          <div className="osint-row"><span className="osint-icon">&#127760;</span><span>IP: {safe(ipCity)}</span></div>
        )}
        {ipGeo.isp && ipGeo.isp !== 'Local' && (
          <div className="osint-row"><span className="osint-icon">&#128274;</span>
            <span>ISP: {safe(ipGeo.isp)}{ipGeo.mobile && ' (Mobile)'}{ipGeo.proxy && <span className="sc-warn"> Proxy!</span>}</span>
          </div>
        )}
        {(ua.device || ua.os) && (
          <div className="osint-row"><span className="osint-icon">&#128241;</span>
            <span>{[ua.device, ua.os, ua.browser].filter(Boolean).map(safe).join(' / ')}</span>
          </div>
        )}
        {bat.level != null && (
          <div className="osint-row"><span className="osint-icon">&#128267;</span>
            <span>{safe(bat.level)}% {bat.charging ? 'Charging' : ''}</span>
          </div>
        )}
        {net.type && (
          <div className="osint-row"><span className="osint-icon">&#128225;</span>
            <span>{safe(net.type).toUpperCase()}{net.downlink ? ` | ${safe(net.downlink)} Mbps` : ''}</span>
          </div>
        )}
        {screenStr && (
          <div className="osint-row"><span className="osint-icon">&#128421;</span>
            <span>Screen: {screenStr}{dev.pixelRatio > 1 ? ` @${dev.pixelRatio}x` : ''}</span>
          </div>
        )}
        {dev.timezone && (
          <div className="osint-row"><span className="osint-icon">&#127757;</span><span>{safe(dev.timezone)}</span></div>
        )}
      </div>

      {/* Admin Controls */}
      {!past && (
        <div className="admin-controls">
          <button className="ctrl-btn ctrl-share" onClick={() => setShowSharePanel(!showSharePanel)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg> Share Tracking Link
          </button>
          {showSharePanel && (
            <div className="share-panel">
              <div className="share-panel-row"><input type="tel" placeholder="Patient/family phone (+91...)" value={sharePhone} onChange={e => setSharePhone(e.target.value)} className="share-phone-input" /></div>
              <div className="share-panel-row">
                <button className="ctrl-btn ctrl-whatsapp" onClick={() => onWhatsApp(s.token, s.staffName, sharePhone)}>WhatsApp</button>
                <button className="ctrl-btn ctrl-copy" onClick={() => onCopy(s.token)}>Copy Link</button>
                <button className="ctrl-btn ctrl-generic" onClick={() => onShare(s.token, s.staffName)}>Share</button>
              </div>
            </div>
          )}
          {onViewRoute && loc && (
            <button className="ctrl-btn" onClick={() => onViewRoute(s.token, s.staffName)} style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #86efac' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>
              </svg> View Route
            </button>
          )}
          <button className="ctrl-btn ctrl-duration" onClick={() => setShowDuration(!showDuration)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg> Set Duration
          </button>
          {showDuration && showDuration !== 'custom' && (
            <div className="duration-panel"><div className="duration-grid">
              {DURATION_OPTIONS.map(opt => (<button key={opt.value} className="dur-btn" onClick={() => handleDurationSelect(opt.value)}>{opt.label}</button>))}
            </div></div>
          )}
          {showDuration === 'custom' && (
            <div className="duration-panel"><div className="custom-duration">
              <input type="number" placeholder="Hours (e.g. 36)" min="0.5" max="720" step="0.5" value={customHours} onChange={e => setCustomHours(e.target.value)} className="share-phone-input" />
              <button className="ctrl-btn ctrl-copy" onClick={handleCustomDuration}>Set</button>
              <button className="ctrl-btn" onClick={() => setShowDuration(false)} style={{ background: 'var(--gray-100)' }}>Cancel</button>
            </div></div>
          )}
          {isOffline && onWakePush && (
            <button className="ctrl-btn" onClick={() => onWakePush(s.token)} style={{ background: '#fbbf24', color: '#78350f', border: '1px solid #f59e0b' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg> Wake Device
            </button>
          )}
          <button className="ctrl-btn ctrl-stop" onClick={() => onStop(s.token)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> Stop Tracking
          </button>
        </div>
      )}
    </div>
  );
}
